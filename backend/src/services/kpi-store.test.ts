import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

import { insertKpiSnapshot, getKpiHistory, cleanOldKpiSnapshots } from './kpi-store.js';

describe('KPI Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertKpiSnapshot', () => {
    it('should insert a KPI snapshot', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await insertKpiSnapshot({
        endpoints: 3,
        endpoints_up: 2,
        endpoints_down: 1,
        running: 15,
        stopped: 5,
        healthy: 12,
        unhealthy: 3,
        total: 20,
        stacks: 4,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO kpi_snapshots'),
        [3, 2, 1, 15, 5, 12, 3, 20, 4],
      );
    });
  });

  describe('getKpiHistory', () => {
    it('should return snapshots from the last N hours', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { endpoints: 3, endpoints_up: 2, endpoints_down: 1, running: 15, stopped: 5, healthy: 12, unhealthy: 3, total: 20, stacks: 4, timestamp: '2025-01-01T10:00:00Z' },
        ],
      });

      const history = await getKpiHistory(24);
      expect(history).toHaveLength(1);
      expect(history[0].endpoints).toBe(3);
      expect(history[0].running).toBe(15);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('kpi_snapshots'),
        [24],
      );
    });

    it('should return empty array when no snapshots exist', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const history = await getKpiHistory(24);
      expect(history).toEqual([]);
    });
  });

  describe('cleanOldKpiSnapshots', () => {
    it('should delete snapshots older than retention period', async () => {
      mockQuery.mockResolvedValue({ rowCount: 5 });

      const deleted = await cleanOldKpiSnapshots(7);
      expect(deleted).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM kpi_snapshots'),
        [7],
      );
    });

    it('should return 0 when nothing to clean', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const deleted = await cleanOldKpiSnapshots(7);
      expect(deleted).toBe(0);
    });
  });
});
