import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@dashboard/core/db/app-db.js';

/**
 * Regression tests for status-page-store async AppDb queries.
 *
 * These tests mock the AppDb interface returned by getDbForDomain()
 * and verify correct SQL parameter passing and result transformation.
 */

const mockMonitoringDb: AppDb = {
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 0 })),
  transaction: vi.fn(async (fn) => fn(mockMonitoringDb)),
  healthCheck: vi.fn(async () => true),
};

const mockIncidentsDb: AppDb = {
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 0 })),
  transaction: vi.fn(async (fn) => fn(mockIncidentsDb)),
  healthCheck: vi.fn(async () => true),
};

// Kept: tests verify domain-based routing (monitoring vs incidents) and SQL parameter passing
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: vi.fn((domain: string) => {
    if (domain === 'monitoring') return mockMonitoringDb;
    if (domain === 'incidents') return mockIncidentsDb;
    throw new Error(`Unexpected domain: ${domain}`);
  }),
}));

// Mock settings-store so getStatusPageConfig doesn't hit a real settings table
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getSetting: vi.fn(async () => undefined),
}));

describe('status-page-store SQL queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOverallUptime', () => {
    it('should return 100 when no snapshots exist', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue(null);
      const { getOverallUptime } = await import('../services/status-page-store.js');

      const result = await getOverallUptime(24);
      expect(result).toBe(100);
    });

    it('should return 100 when total_all is 0', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: 0, total_all: 0 });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      const result = await getOverallUptime(24);
      expect(result).toBe(100);
    });

    it('should calculate uptime from snapshots', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: 8, total_all: 10 });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      const result = await getOverallUptime(24);
      // 8 running out of 10 total = 80%
      expect(result).toBe(80);
    });

    it('should pass a cutoff timestamp as parameter', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: 0, total_all: 0 });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      const before = Date.now();
      await getOverallUptime(24);
      const after = Date.now();

      expect(mockMonitoringDb.queryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = vi.mocked(mockMonitoringDb.queryOne).mock.calls[0];
      expect(sql).toContain('monitoring_snapshots');
      expect(sql).toContain('WHERE created_at >= ?');
      expect(params).toHaveLength(1);

      // The cutoff should be approximately 24 hours ago
      const cutoff = new Date(params![0] as string).getTime();
      const expectedCutoff = before - 24 * 3600_000;
      expect(cutoff).toBeGreaterThanOrEqual(expectedCutoff - 1000);
      expect(cutoff).toBeLessThanOrEqual(after - 24 * 3600_000 + 1000);
    });

    it('should not throw for different hour values (regression)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: 0, total_all: 0 });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      await expect(getOverallUptime(24)).resolves.not.toThrow();
      await expect(getOverallUptime(168)).resolves.not.toThrow();
      await expect(getOverallUptime(720)).resolves.not.toThrow();
    });
  });

  describe('getEndpointUptime', () => {
    it('should return 100 when no snapshots exist', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue(null);
      const { getEndpointUptime } = await import('../services/status-page-store.js');

      const result = await getEndpointUptime(24);
      expect(result).toBe(100);
    });

    it('should calculate endpoint uptime from snapshots', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_up: 3, total_all: 4 });
      const { getEndpointUptime } = await import('../services/status-page-store.js');

      const result = await getEndpointUptime(24);
      // 3 up out of 4 total = 75%
      expect(result).toBe(75);
    });

    it('should not throw for different hour values (regression)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_up: 0, total_all: 0 });
      const { getEndpointUptime } = await import('../services/status-page-store.js');

      await expect(getEndpointUptime(24)).resolves.not.toThrow();
      await expect(getEndpointUptime(168)).resolves.not.toThrow();
      await expect(getEndpointUptime(720)).resolves.not.toThrow();
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return null when no snapshots exist', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue(null);
      const { getLatestSnapshot } = await import('../services/status-page-store.js');

      const result = await getLatestSnapshot();
      expect(result).toBeNull();
    });

    it('should return mapped snapshot data', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({
        containers_running: 5,
        containers_stopped: 1,
        containers_unhealthy: 0,
        endpoints_up: 3,
        endpoints_down: 1,
        created_at: '2026-02-14T12:00:00Z',
      });
      const { getLatestSnapshot } = await import('../services/status-page-store.js');

      const result = await getLatestSnapshot();
      expect(result).toEqual({
        containersRunning: 5,
        containersStopped: 1,
        containersUnhealthy: 0,
        endpointsUp: 3,
        endpointsDown: 1,
        createdAt: '2026-02-14T12:00:00Z',
      });
    });
  });

  describe('getDailyUptimeBuckets', () => {
    it('should return empty array when no snapshots exist', async () => {
      vi.mocked(mockMonitoringDb.query).mockResolvedValue([]);
      const { getDailyUptimeBuckets } = await import('../services/status-page-store.js');

      const result = await getDailyUptimeBuckets(30);
      expect(result).toEqual([]);
    });

    it('should return daily buckets with uptime percentages', async () => {
      vi.mocked(mockMonitoringDb.query).mockResolvedValue([
        { date: '2026-02-13', total_running: 7, total_all: 10 },
        { date: '2026-02-14', total_running: 10, total_all: 10 },
      ]);
      const { getDailyUptimeBuckets } = await import('../services/status-page-store.js');

      const result = await getDailyUptimeBuckets(30);
      expect(result).toEqual([
        { date: '2026-02-13', uptime_pct: 70 },
        { date: '2026-02-14', uptime_pct: 100 },
      ]);
    });

    it('should return 100% when total_all is 0', async () => {
      vi.mocked(mockMonitoringDb.query).mockResolvedValue([
        { date: '2026-02-14', total_running: 0, total_all: 0 },
      ]);
      const { getDailyUptimeBuckets } = await import('../services/status-page-store.js');

      const result = await getDailyUptimeBuckets(30);
      expect(result).toEqual([{ date: '2026-02-14', uptime_pct: 100 }]);
    });

    it('should not throw for different day values (regression)', async () => {
      vi.mocked(mockMonitoringDb.query).mockResolvedValue([]);
      const { getDailyUptimeBuckets } = await import('../services/status-page-store.js');

      await expect(getDailyUptimeBuckets(7)).resolves.not.toThrow();
      await expect(getDailyUptimeBuckets(30)).resolves.not.toThrow();
      await expect(getDailyUptimeBuckets(90)).resolves.not.toThrow();
    });
  });

  describe('getRecentIncidentsPublic', () => {
    it('should return empty array when no incidents exist', async () => {
      vi.mocked(mockIncidentsDb.query).mockResolvedValue([]);
      const { getRecentIncidentsPublic } = await import('../services/status-page-store.js');

      const result = await getRecentIncidentsPublic(10);
      expect(result).toEqual([]);
    });

    it('should query incidents domain with limit parameter', async () => {
      vi.mocked(mockIncidentsDb.query).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Test incident',
          severity: 'critical',
          status: 'resolved',
          created_at: '2026-02-14T10:00:00Z',
          resolved_at: '2026-02-14T10:30:00Z',
          summary: 'Test summary',
        },
      ]);
      const { getRecentIncidentsPublic } = await import('../services/status-page-store.js');

      const result = await getRecentIncidentsPublic(5);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test incident');

      expect(mockIncidentsDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM incidents'),
        [5],
      );
    });
  });
});
