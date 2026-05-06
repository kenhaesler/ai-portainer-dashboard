import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock at module level before importing
const mockDb = {
  queryOne: vi.fn(),
  execute: vi.fn(),
};

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => mockDb,
}));

import { resolveIncidentsBatch } from '../services/incident-store.js';

describe('resolveIncidentsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves all valid ids', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ id: 'a' })
      .mockResolvedValueOnce({ id: 'b' })
      .mockResolvedValueOnce({ id: 'c' });
    mockDb.execute.mockResolvedValue(undefined);

    const result = await resolveIncidentsBatch(['a', 'b', 'c']);

    expect(result.resolved).toEqual(['a', 'b', 'c']);
    expect(result.failed).toEqual([]);
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('does not roll back successful ids when one fails', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ id: 'a' })
      .mockResolvedValueOnce(null) // does-not-exist
      .mockResolvedValueOnce({ id: 'c' });
    mockDb.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await resolveIncidentsBatch(['a', 'does-not-exist', 'c']);

    expect(result.resolved.sort()).toEqual(['a', 'c']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('does-not-exist');
    expect(result.failed[0].error).toBe('not found');
    // Only 2 executes should have been called
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it('handles errors from database operations', async () => {
    const dbError = new Error('Database error');
    mockDb.queryOne
      .mockResolvedValueOnce({ id: 'a' })
      .mockResolvedValueOnce({ id: 'b' })
      .mockResolvedValueOnce({ id: 'c' });
    mockDb.execute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(dbError)
      .mockResolvedValueOnce(undefined);

    const result = await resolveIncidentsBatch(['a', 'b', 'c']);

    expect(result.resolved).toEqual(['a', 'c']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('b');
    expect(result.failed[0].error).toBe('Database error');
  });

  it('handles empty id list', async () => {
    const result = await resolveIncidentsBatch([]);
    expect(result.resolved).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(mockDb.queryOne).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});
