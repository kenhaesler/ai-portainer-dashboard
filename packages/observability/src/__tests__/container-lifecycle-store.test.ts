import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TimescaleDB pool — no Timescale in CI (matches reports-route.test.ts).
const mockQuery = vi.fn();
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...a: unknown[]) => mockQuery(...a) }),
}));

import { getRunningContainerIds } from '../services/container-lifecycle-store.js';

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
