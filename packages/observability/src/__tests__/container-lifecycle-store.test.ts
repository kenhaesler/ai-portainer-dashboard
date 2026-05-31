import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TimescaleDB pools — no Timescale in CI (matches reports-route.test.ts).
// Two distinct query spies so tests can assert which pool each operation uses:
//   - getMetricsDb()  → write pool (no statement_timeout) — used for upserts.
//   - getReportsDb()  → isolated reports pool (10 s statement_timeout) — used by
//     the read path so it respects read/write isolation (#1394).
const mockMetricsQuery = vi.fn();
const mockReportsQuery = vi.fn();
const mockGetMetricsDb = vi.fn().mockResolvedValue({ query: (...a: unknown[]) => mockMetricsQuery(...a) });
const mockGetReportsDb = vi.fn().mockResolvedValue({ query: (...a: unknown[]) => mockReportsQuery(...a) });
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: (...a: unknown[]) => mockGetMetricsDb(...a),
  getReportsDb: (...a: unknown[]) => mockGetReportsDb(...a),
}));

import { getRunningContainerIds, upsertContainerLifecycle } from '../services/container-lifecycle-store.js';

beforeEach(() => {
  mockMetricsQuery.mockReset();
  mockReportsQuery.mockReset();
  mockGetMetricsDb.mockClear();
  mockGetReportsDb.mockClear();
});

describe('getRunningContainerIds', () => {
  it('returns the set of currently-running container ids', async () => {
    mockReportsQuery.mockResolvedValueOnce({
      rows: [
        { container_id: 'a', running: true },
        { container_id: 'b', running: false },
        { container_id: 'c', running: true },
      ],
    });
    const ids = await getRunningContainerIds(4);
    expect(ids).toEqual(new Set(['a', 'c']));
  });

  it('returns null (fail open) when the scope has no lifecycle rows', async () => {
    mockReportsQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getRunningContainerIds(4)).toBeNull();
  });

  it('returns null when the table does not exist yet (42P01)', async () => {
    const err = Object.assign(new Error('relation "container_lifecycle" does not exist'), { code: '42P01' });
    mockReportsQuery.mockRejectedValueOnce(err);
    expect(await getRunningContainerIds()).toBeNull();
  });

  it('reads via the isolated reports pool, not the metrics write pool (#1394)', async () => {
    mockReportsQuery.mockResolvedValueOnce({ rows: [{ container_id: 'a', running: true }] });
    await getRunningContainerIds(4);
    // Must inherit the reports pool's statement_timeout / read-write isolation.
    expect(mockGetReportsDb).toHaveBeenCalledTimes(1);
    expect(mockReportsQuery).toHaveBeenCalledTimes(1);
    expect(mockGetMetricsDb).not.toHaveBeenCalled();
    expect(mockMetricsQuery).not.toHaveBeenCalled();
  });

  it('parameterizes the endpoint-scoped query identically on the reports pool', async () => {
    mockReportsQuery.mockResolvedValueOnce({ rows: [] });
    await getRunningContainerIds(7);
    const [sql, params] = mockReportsQuery.mock.calls[0];
    expect(sql).toMatch(/SELECT container_id, running FROM container_lifecycle WHERE endpoint_id = \$1/);
    expect(params).toEqual([7]);
  });
});

describe('upsertContainerLifecycle', () => {
  it('upserts current containers and marks absent ones not-running', async () => {
    mockMetricsQuery.mockResolvedValue({ rows: [] });

    await upsertContainerLifecycle(4, [
      { Id: 'aaa', Names: ['/web'], State: 'running' },
      { Id: 'bbb', Names: ['/db'], State: 'exited' },
    ]);

    expect(mockMetricsQuery).toHaveBeenCalledTimes(2);

    const [upsertSql, upsertParams] = mockMetricsQuery.mock.calls[0];
    expect(upsertSql).toMatch(/INSERT INTO container_lifecycle/);
    expect(upsertSql).toMatch(/ON CONFLICT \(endpoint_id, container_id\) DO UPDATE/);
    expect(upsertParams[0]).toBe(4);
    expect(upsertParams[1]).toEqual(['aaa', 'bbb']);   // ids
    expect(upsertParams[2]).toEqual(['web', 'db']);    // names, leading slash stripped
    expect(upsertParams[3]).toEqual([true, false]);    // running flags

    const [reconcileSql, reconcileParams] = mockMetricsQuery.mock.calls[1];
    expect(reconcileSql).toMatch(/SET running = FALSE/);
    expect(reconcileSql).toMatch(/<> ALL/);
    expect(reconcileParams).toEqual([4, ['aaa', 'bbb']]);
  });

  it('writes via the metrics write pool, not the reports read pool (#1394)', async () => {
    mockMetricsQuery.mockResolvedValue({ rows: [] });
    await upsertContainerLifecycle(4, [{ Id: 'aaa', Names: ['/web'], State: 'running' }]);
    expect(mockGetMetricsDb).toHaveBeenCalled();
    expect(mockGetReportsDb).not.toHaveBeenCalled();
  });

  it('is a no-op when the container list is empty', async () => {
    await upsertContainerLifecycle(4, []);
    expect(mockMetricsQuery).not.toHaveBeenCalled();
  });
});
