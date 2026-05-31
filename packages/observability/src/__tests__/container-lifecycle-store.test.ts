import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TimescaleDB pool — no Timescale in CI (matches reports-route.test.ts).
const mockQuery = vi.fn();
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...a: unknown[]) => mockQuery(...a) }),
}));

import { getRunningContainerIds, upsertContainerLifecycle } from '../services/container-lifecycle-store.js';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getRunningContainerIds', () => {
  it('returns the set of currently-running container ids', async () => {
    mockQuery.mockResolvedValueOnce({
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
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getRunningContainerIds(4)).toBeNull();
  });

  it('returns null when the table does not exist yet (42P01)', async () => {
    const err = Object.assign(new Error('relation "container_lifecycle" does not exist'), { code: '42P01' });
    mockQuery.mockRejectedValueOnce(err);
    expect(await getRunningContainerIds()).toBeNull();
  });
});

describe('upsertContainerLifecycle', () => {
  it('upserts current containers and marks absent ones not-running', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await upsertContainerLifecycle(4, [
      { Id: 'aaa', Names: ['/web'], State: 'running' },
      { Id: 'bbb', Names: ['/db'], State: 'exited' },
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [upsertSql, upsertParams] = mockQuery.mock.calls[0];
    expect(upsertSql).toMatch(/INSERT INTO container_lifecycle/);
    expect(upsertSql).toMatch(/ON CONFLICT \(endpoint_id, container_id\) DO UPDATE/);
    expect(upsertParams[0]).toBe(4);
    expect(upsertParams[1]).toEqual(['aaa', 'bbb']);   // ids
    expect(upsertParams[2]).toEqual(['web', 'db']);    // names, leading slash stripped
    expect(upsertParams[3]).toEqual([true, false]);    // running flags

    const [reconcileSql, reconcileParams] = mockQuery.mock.calls[1];
    expect(reconcileSql).toMatch(/SET running = FALSE/);
    expect(reconcileSql).toMatch(/<> ALL/);
    expect(reconcileParams).toEqual([4, ['aaa', 'bbb']]);
  });

  it('is a no-op when the container list is empty', async () => {
    await upsertContainerLifecycle(4, []);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
