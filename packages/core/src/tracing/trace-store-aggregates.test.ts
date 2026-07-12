/**
 * DB-backed regression tests for trace-store aggregate queries (#1526).
 *
 * pg returns uncast SUM()/COUNT()/AVG() aggregates as strings (bigint/numeric),
 * so getTraces() returned duration_ms as a string and getTraceSummary()
 * returned totalTraces/services as strings despite their numeric TypeScript
 * types. These tests run the real queries against the test database and pin
 * the ::integer / ::float casts.
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
 *   npx vitest run src/tracing/trace-store-aggregates.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';

let testDb: AppDb;

vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

const { getTraces, getServiceMap, getTraceSummary } = await import('./trace-store.js');

async function seedSpan(opts: {
  id: string;
  traceId: string;
  parentSpanId?: string | null;
  name: string;
  status?: 'ok' | 'error';
  durationMs: number;
  serviceName: string;
}): Promise<void> {
  await testDb.execute(
    `INSERT INTO spans (
      id, trace_id, parent_span_id, name, kind, status,
      start_time, end_time, duration_ms, service_name, attributes
    ) VALUES (?, ?, ?, ?, 'server', ?, NOW(), NOW(), ?, ?, '{}')`,
    [
      opts.id,
      opts.traceId,
      opts.parentSpanId ?? null,
      opts.name,
      opts.status ?? 'ok',
      opts.durationMs,
      opts.serviceName,
    ],
  );
}

describe('trace-store aggregates (real PostgreSQL)', () => {
  beforeAll(async () => {
    testDb = await getTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('spans');
  });

  it('getTraceSummary returns numeric zeros for an empty table (#1526 regression)', async () => {
    const summary = await getTraceSummary();

    // toEqual with numbers fails if pg hands back '0' strings
    expect(summary).toEqual({
      totalTraces: 0,
      avgDuration: 0,
      errorRate: 0,
      services: 0,
    });
  });

  describe('with seeded spans', () => {
    beforeEach(async () => {
      await seedSpan({ id: 'sp-1', traceId: 'tr-1', name: 'GET /x', durationMs: 100, serviceName: 'api-gateway' });
      await seedSpan({ id: 'sp-2', traceId: 'tr-1', parentSpanId: 'sp-1', name: 'cache.get', durationMs: 50, serviceName: 'redis' });
      await seedSpan({ id: 'sp-3', traceId: 'tr-2', name: 'GET /y', status: 'error', durationMs: 200, serviceName: 'api-gateway' });
    });

    it('getTraces returns duration_ms as a number (#1526 regression)', async () => {
      const traces = await getTraces();

      expect(traces).toHaveLength(2);
      const tr1 = traces.find((t) => t.trace_id === 'tr-1');
      const tr2 = traces.find((t) => t.trace_id === 'tr-2');

      expect(tr1).toMatchObject({ duration_ms: 150, span_count: 2, status: 'ok' });
      expect(tr2).toMatchObject({ duration_ms: 200, span_count: 1, status: 'error' });
      expect(typeof tr1!.duration_ms).toBe('number');
    });

    it('getTraceSummary returns numeric aggregates', async () => {
      const summary = await getTraceSummary();

      expect(summary).toEqual({
        totalTraces: 2,
        avgDuration: 116.67,
        errorRate: 0.3333,
        services: 2,
      });
    });

    it('getServiceMap returns numeric callCount and avgDuration', async () => {
      const { nodes, edges } = await getServiceMap();

      const gateway = nodes.find((n) => n.id === 'api-gateway');
      const redis = nodes.find((n) => n.id === 'redis');

      expect(gateway).toMatchObject({ callCount: 2, avgDuration: 150 });
      expect(redis).toMatchObject({ callCount: 1, avgDuration: 50 });
      expect(typeof gateway!.avgDuration).toBe('number');

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'api-gateway',
        target: 'redis',
        callCount: 1,
        avgDuration: 50,
      });
      expect(typeof edges[0].avgDuration).toBe('number');
    });
  });
});
