import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { computeRed } from './trace-red.js';

let appDb: AppDb;

// Mock the db-router used by the service to point at the test DB.
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));

interface TestSpanOptions {
  id?: string;
  trace_id?: string;
  service_name: string;
  duration_ms: number;
  start_time: Date;
  status: 'ok' | 'error' | 'unset';
  container_name?: string | null;
  http_route?: string | null;
  k8s_namespace?: string | null;
}

let spanCounter = 0;
async function insertTestSpan(opts: TestSpanOptions): Promise<void> {
  spanCounter += 1;
  const id = opts.id ?? `s-${spanCounter}`;
  const traceId = opts.trace_id ?? `t-${spanCounter}`;
  await appDb.execute(
    `INSERT INTO spans (
       id, trace_id, parent_span_id, name, kind, status,
       start_time, end_time, duration_ms, service_name, attributes,
       container_name, http_route, k8s_namespace, created_at
     ) VALUES (?, ?, NULL, ?, 'server', ?, ?, ?, ?, ?, '{}', ?, ?, ?, NOW())`,
    [
      id,
      traceId,
      'op',
      opts.status,
      opts.start_time.toISOString(),
      opts.start_time.toISOString(),
      opts.duration_ms,
      opts.service_name,
      opts.container_name ?? null,
      opts.http_route ?? null,
      opts.k8s_namespace ?? null,
    ],
  );
}

beforeAll(async () => {
  appDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('spans');
  spanCounter = 0;
});

describe('computeRed', () => {
  it('returns p50/p95/p99 per bucket grouped by service', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 1; i <= 100; i++) {
      await insertTestSpan({ service_name: 'api', duration_ms: i, start_time: now, status: 'ok' });
    }
    const result = await computeRed({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
      bucket: '1h',
      groupBy: 'service',
    });
    expect(result.truncated).toBe(false);
    expect(result.buckets.length).toBeGreaterThanOrEqual(1);
    const allRows = result.buckets.flatMap((b) => b.rows);
    const row = allRows.find((r) => r.group === 'api')!;
    expect(row).toBeDefined();
    expect(row.callCount).toBe(100);
    expect(row.p50Ms).toBeCloseTo(50.5, 0);
    expect(row.p95Ms).toBeCloseTo(95, 0);
    expect(row.p99Ms).toBeCloseTo(99, 0);
    expect(row.errorRate).toBe(0);
    // 100 calls within a 1h bucket = 100 / 3600 ≈ 0.0278 req/s.
    expect(row.rate).toBeCloseTo(100 / 3600, 3);
  });

  it('rate is per-bucket, not per-window — independent of window length', async () => {
    // 60 spans inside a single 1m bucket. The window is 1h (large vs bucket).
    // If rate divided by window length we'd see 60/3600 = 0.0167.
    // With the bucket divisor we should see 60/60 = 1.0 req/s.
    const now = new Date('2026-05-14T12:00:30Z');
    for (let i = 0; i < 60; i++) {
      await insertTestSpan({ service_name: 'api', duration_ms: 5, start_time: now, status: 'ok' });
    }
    const result = await computeRed({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
      bucket: '1m',
      groupBy: 'service',
    });
    const allRows = result.buckets.flatMap((b) => b.rows);
    const row = allRows.find((r) => r.group === 'api')!;
    expect(row.callCount).toBe(60);
    expect(row.rate).toBeCloseTo(1.0, 2);
  });

  it('errorRate counts only status=error', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 0; i < 80; i++) {
      await insertTestSpan({ service_name: 'api', duration_ms: 10, start_time: now, status: 'ok' });
    }
    for (let i = 0; i < 20; i++) {
      await insertTestSpan({ service_name: 'api', duration_ms: 10, start_time: now, status: 'error' });
    }
    const result = await computeRed({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
      bucket: '1h',
      groupBy: 'service',
    });
    const allRows = result.buckets.flatMap((b) => b.rows);
    const row = allRows.find((r) => r.group === 'api')!;
    expect(row.errorRate).toBeCloseTo(0.2);
  });

  it('truncates and flags when row count exceeds 100 per bucket', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 0; i < 150; i++) {
      await insertTestSpan({ service_name: `svc-${i}`, duration_ms: 1, start_time: now, status: 'ok' });
    }
    const result = await computeRed({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
      bucket: '1h',
      groupBy: 'service',
    });
    expect(result.truncated).toBe(true);
    // Sum rows across all buckets — implementation caps per bucket at 100.
    const totalRows = result.buckets.reduce((acc, b) => acc + b.rows.length, 0);
    expect(totalRows).toBeLessThanOrEqual(100 * result.buckets.length);
    // Ensure at least one bucket hit the cap.
    expect(result.buckets.some((b) => b.rows.length === 100)).toBe(true);
  });

  it('filters by container', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    await insertTestSpan({
      service_name: 'api',
      duration_ms: 10,
      start_time: now,
      container_name: 'webA',
      status: 'ok',
    });
    await insertTestSpan({
      service_name: 'api',
      duration_ms: 20,
      start_time: now,
      container_name: 'webB',
      status: 'ok',
    });
    const result = await computeRed({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
      bucket: '1h',
      groupBy: 'service',
      filters: { container: 'webA' },
    });
    const allRows = result.buckets.flatMap((b) => b.rows);
    expect(allRows.find((r) => r.group === 'api')!.callCount).toBe(1);
  });
});
