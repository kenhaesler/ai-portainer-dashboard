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
  getSetting: vi.fn(async () => null),
  getSettingsByKeys: vi.fn(async () => []),
}));

import { getSettingsByKeys } from '@dashboard/core/services/settings-store.js';

describe('status-page-store SQL queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettingsByKeys).mockResolvedValue([]);
  });

  describe('getStatusPageConfig', () => {
    it('should fetch all settings in a single batched query', async () => {
      const { getStatusPageConfig } = await import('../services/status-page-store.js');

      await getStatusPageConfig();

      expect(getSettingsByKeys).toHaveBeenCalledTimes(1);
      expect(getSettingsByKeys).toHaveBeenCalledWith([
        'status.page.enabled',
        'status.page.title',
        'status.page.description',
        'status.page.show_incidents',
        'status.page.refresh_interval',
      ]);
    });

    it('should return defaults when no settings exist', async () => {
      const { getStatusPageConfig } = await import('../services/status-page-store.js');

      const config = await getStatusPageConfig();
      expect(config).toEqual({
        enabled: false,
        title: 'System Status',
        description: '',
        showIncidents: true,
        autoRefreshSeconds: 30,
      });
    });

    it('should map stored settings onto the config', async () => {
      vi.mocked(getSettingsByKeys).mockResolvedValue([
        { key: 'status.page.enabled', value: 'true', category: 'status_page', updated_at: '' },
        { key: 'status.page.title', value: 'My Status', category: 'status_page', updated_at: '' },
        { key: 'status.page.show_incidents', value: 'false', category: 'status_page', updated_at: '' },
        { key: 'status.page.refresh_interval', value: '60', category: 'status_page', updated_at: '' },
      ]);
      const { getStatusPageConfig } = await import('../services/status-page-store.js');

      const config = await getStatusPageConfig();
      expect(config).toEqual({
        enabled: true,
        title: 'My Status',
        description: '',
        showIncidents: false,
        autoRefreshSeconds: 60,
      });
    });
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

    it('should return 100 (not NaN) when pg returns bigint sums as strings (#1526)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: '0', total_all: '0' });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      const result = await getOverallUptime(24);
      expect(result).toBe(100);
      expect(Number.isNaN(result)).toBe(false);
    });

    it('should compute uptime when pg returns bigint sums as strings (#1526)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: '8', total_all: '10' });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      expect(await getOverallUptime(24)).toBe(80);
    });

    it('should cast the SUM aggregates to integer in SQL (#1526)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_running: 0, total_all: 0 });
      const { getOverallUptime } = await import('../services/status-page-store.js');

      await getOverallUptime(24);
      const [sql] = vi.mocked(mockMonitoringDb.queryOne).mock.calls[0];
      expect(sql).toContain('::integer as total_running');
      expect(sql).toContain('::integer as total_all');
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

    it('should return 100 (not NaN) when pg returns bigint sums as strings (#1526)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({ total_up: '0', total_all: '0' });
      const { getEndpointUptime } = await import('../services/status-page-store.js');

      const result = await getEndpointUptime(24);
      expect(result).toBe(100);
      expect(Number.isNaN(result)).toBe(false);
    });
  });

  describe('getUptimeSummary', () => {
    it('should compute all six windows from a single query', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({
        containers_running_24h: 8,
        containers_all_24h: 10,
        containers_running_7d: 70,
        containers_all_7d: 100,
        containers_running_30d: 270,
        containers_all_30d: 300,
        endpoints_up_24h: 3,
        endpoints_all_24h: 4,
        endpoints_up_7d: 39,
        endpoints_all_7d: 40,
        endpoints_up_30d: 160,
        endpoints_all_30d: 160,
      });
      const { getUptimeSummary } = await import('../services/status-page-store.js');

      const result = await getUptimeSummary();

      expect(mockMonitoringDb.queryOne).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        containers: { '24h': 80, '7d': 70, '30d': 90 },
        endpoints: { '24h': 75, '7d': 97.5, '30d': 100 },
      });
    });

    it('should use FILTER clauses over the 30d superset window', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue(null);
      const { getUptimeSummary } = await import('../services/status-page-store.js');

      await getUptimeSummary();

      const [sql, params] = vi.mocked(mockMonitoringDb.queryOne).mock.calls[0];
      expect(sql).toContain('FILTER (WHERE created_at >= ?)');
      expect(sql).toContain('WHERE created_at >= ?');
      expect(params).toHaveLength(9);

      // Last param is the 30d superset cutoff for the outer WHERE
      const cutoff30d = new Date(params![8] as string).getTime();
      expect(cutoff30d).toBeLessThanOrEqual(Date.now() - 720 * 3600_000 + 1000);
    });

    it('should return 100 everywhere for an empty window (never NaN)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue(null);
      const { getUptimeSummary } = await import('../services/status-page-store.js');

      const result = await getUptimeSummary();
      expect(result).toEqual({
        containers: { '24h': 100, '7d': 100, '30d': 100 },
        endpoints: { '24h': 100, '7d': 100, '30d': 100 },
      });
    });

    it('should coerce pg bigint-as-string sums (#1526)', async () => {
      vi.mocked(mockMonitoringDb.queryOne).mockResolvedValue({
        containers_running_24h: '0',
        containers_all_24h: '0',
        containers_running_7d: '8',
        containers_all_7d: '10',
        containers_running_30d: '0',
        containers_all_30d: '0',
        endpoints_up_24h: '0',
        endpoints_all_24h: '0',
        endpoints_up_7d: '0',
        endpoints_all_7d: '0',
        endpoints_up_30d: '3',
        endpoints_all_30d: '4',
      });
      const { getUptimeSummary } = await import('../services/status-page-store.js');

      const result = await getUptimeSummary();
      expect(result.containers).toEqual({ '24h': 100, '7d': 80, '30d': 100 });
      expect(result.endpoints).toEqual({ '24h': 100, '7d': 100, '30d': 75 });
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

    it('should return 100 (not NaN) when pg returns bigint sums as strings (#1526)', async () => {
      vi.mocked(mockMonitoringDb.query).mockResolvedValue([
        { date: '2026-02-13', total_running: '0', total_all: '0' },
        { date: '2026-02-14', total_running: '7', total_all: '10' },
      ]);
      const { getDailyUptimeBuckets } = await import('../services/status-page-store.js');

      const result = await getDailyUptimeBuckets(30);
      expect(result).toEqual([
        { date: '2026-02-13', uptime_pct: 100 },
        { date: '2026-02-14', uptime_pct: 70 },
      ]);
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
