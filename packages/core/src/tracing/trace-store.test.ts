import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';
import { insertSpans, type SpanInsert } from './trace-store.js';

let appDb: AppDb;

beforeAll(async () => {
  appDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('spans');
});

function makeSpan(id: string, overrides: Partial<SpanInsert> = {}): SpanInsert {
  return {
    id,
    trace_id: `trace-${id}`,
    parent_span_id: null,
    name: `GET /api/${id}`,
    kind: 'server',
    status: 'ok',
    start_time: '2026-07-12T10:00:00.000Z',
    end_time: '2026-07-12T10:00:00.050Z',
    duration_ms: 50,
    service_name: 'api-gateway',
    attributes: '{}',
    ...overrides,
  };
}

describe('insertSpans (unnest batch insert)', () => {
  it('inserts a whole batch with a single call and preserves typed columns', async () => {
    const count = await insertSpans([
      makeSpan('batch-1', {
        attributes: JSON.stringify({ 'http.method': 'GET', nested: { 'quo"te': 'a"b\\c' } }),
        trace_source: 'http',
        http_method: 'GET',
        http_route: '/users/:id',
        http_status_code: 200,
        container_name: 'api-1',
        net_peer_port: 5432,
      }),
      makeSpan('batch-2', {
        parent_span_id: 'batch-1',
        kind: 'client',
        status: 'error',
        end_time: null,
        duration_ms: null,
        service_name: 'db',
        // No trace_source — insertSpans defaults the OTLP ingest path to 'ebpf'
      }),
    ]);

    expect(count).toBe(2);

    const rows = await appDb.query<Record<string, unknown>>(
      'SELECT * FROM spans ORDER BY id ASC',
    );
    expect(rows).toHaveLength(2);

    const [first, second] = rows;
    expect(first.id).toBe('batch-1');
    expect(first.trace_source).toBe('http');
    expect(first.http_method).toBe('GET');
    expect(first.http_route).toBe('/users/:id');
    expect(first.http_status_code).toBe(200);
    expect(first.container_name).toBe('api-1');
    expect(first.net_peer_port).toBe(5432);
    expect(first.duration_ms).toBe(50);
    expect(first.created_at).toBeTruthy();
    // JSONB round-trip including quotes and backslashes (array-literal escaping)
    expect(first.attributes).toEqual({ 'http.method': 'GET', nested: { 'quo"te': 'a"b\\c' } });

    expect(second.id).toBe('batch-2');
    expect(second.parent_span_id).toBe('batch-1');
    expect(second.status).toBe('error');
    expect(second.end_time).toBeNull();
    expect(second.duration_ms).toBeNull();
    expect(second.trace_source).toBe('ebpf');
  });

  it('handles large batches in one statement', async () => {
    const spans = Array.from({ length: 120 }, (_, i) => makeSpan(`bulk-${String(i).padStart(3, '0')}`));

    const count = await insertSpans(spans);
    expect(count).toBe(120);

    const rows = await appDb.query<{ total: number }>(
      'SELECT COUNT(*)::integer as total FROM spans',
    );
    expect(rows[0].total).toBe(120);
  });

  it('returns 0 for an empty batch without touching the database', async () => {
    await expect(insertSpans([])).resolves.toBe(0);
  });
});

// Kept: trace-store resolves its DB via the domain router — point it at the test DB
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));
