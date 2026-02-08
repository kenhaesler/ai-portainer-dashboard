import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for status-page-store SQL queries.
 *
 * These tests use a real in-memory SQLite database (not mocked) to verify
 * that the datetime() parameter binding in uptime queries works correctly.
 *
 * Bug: datetime('now', ? || ' hours') with .get(`-${hours}`) produced
 * malformed SQL — SQLite silently returned NULL, causing HTTP 500.
 * Fix: datetime('now', ?) with .get(`-${hours} hours`) passes the
 * complete modifier string as the bound parameter.
 */

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    SQLITE_PATH: ':memory:',
  }),
}));

// Mock settings-store so getStatusPageConfig doesn't hit a real settings table
vi.mock('./settings-store.js', () => ({
  getSetting: vi.fn(() => undefined),
}));

describe('status-page-store SQL queries', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('../db/sqlite.js');
    closeDb();
  });

  async function setupDb() {
    const { getDb } = await import('../db/sqlite.js');
    const db = getDb();

    // Create the monitoring_snapshots table (mirrors migration 011)
    db.exec(`
      CREATE TABLE IF NOT EXISTS monitoring_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        containers_running INTEGER NOT NULL,
        containers_stopped INTEGER NOT NULL,
        containers_unhealthy INTEGER NOT NULL,
        endpoints_up INTEGER NOT NULL,
        endpoints_down INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    return db;
  }

  describe('getOverallUptime', () => {
    it('should return 100 when no snapshots exist', async () => {
      await setupDb();
      const { getOverallUptime } = await import('./status-page-store.js');

      const result = getOverallUptime(24);
      expect(result).toBe(100);
    });

    it('should calculate uptime from recent snapshots', async () => {
      const db = await setupDb();
      const { getOverallUptime } = await import('./status-page-store.js');

      // Insert a snapshot with created_at = now (within the 24h window)
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (8, 1, 1, 2, 0, datetime('now'))
      `).run();

      const result = getOverallUptime(24);
      // 8 running out of 10 total = 80%
      expect(result).toBe(80);
    });

    it('should exclude snapshots older than the specified hours', async () => {
      const db = await setupDb();
      const { getOverallUptime } = await import('./status-page-store.js');

      // Insert an old snapshot (48 hours ago) — should be excluded from a 24h query
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (0, 10, 0, 0, 2, datetime('now', '-48 hours'))
      `).run();

      // Insert a recent snapshot (1 hour ago) — should be included
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (9, 1, 0, 2, 0, datetime('now', '-1 hours'))
      `).run();

      const result = getOverallUptime(24);
      // Only the recent snapshot counts: 9/10 = 90%
      expect(result).toBe(90);
    });

    it('should not throw with the fixed parameter binding (regression)', async () => {
      await setupDb();
      const { getOverallUptime } = await import('./status-page-store.js');

      // The old code with `? || ' hours'` would cause SQLite to error or
      // return unexpected results. This must not throw.
      expect(() => getOverallUptime(24)).not.toThrow();
      expect(() => getOverallUptime(168)).not.toThrow();
      expect(() => getOverallUptime(720)).not.toThrow();
    });
  });

  describe('getEndpointUptime', () => {
    it('should return 100 when no snapshots exist', async () => {
      await setupDb();
      const { getEndpointUptime } = await import('./status-page-store.js');

      const result = getEndpointUptime(24);
      expect(result).toBe(100);
    });

    it('should calculate endpoint uptime from recent snapshots', async () => {
      const db = await setupDb();
      const { getEndpointUptime } = await import('./status-page-store.js');

      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (5, 0, 0, 3, 1, datetime('now'))
      `).run();

      const result = getEndpointUptime(24);
      // 3 up out of 4 total = 75%
      expect(result).toBe(75);
    });

    it('should exclude snapshots older than the specified hours', async () => {
      const db = await setupDb();
      const { getEndpointUptime } = await import('./status-page-store.js');

      // Old snapshot — excluded
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (5, 0, 0, 0, 5, datetime('now', '-48 hours'))
      `).run();

      // Recent snapshot — included
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (5, 0, 0, 4, 1, datetime('now', '-1 hours'))
      `).run();

      const result = getEndpointUptime(24);
      // 4 up out of 5 total = 80%
      expect(result).toBe(80);
    });

    it('should not throw with the fixed parameter binding (regression)', async () => {
      await setupDb();
      const { getEndpointUptime } = await import('./status-page-store.js');

      expect(() => getEndpointUptime(24)).not.toThrow();
      expect(() => getEndpointUptime(168)).not.toThrow();
      expect(() => getEndpointUptime(720)).not.toThrow();
    });
  });

  describe('getDailyUptimeBuckets', () => {
    it('should return empty array when no snapshots exist', async () => {
      await setupDb();
      const { getDailyUptimeBuckets } = await import('./status-page-store.js');

      const result = getDailyUptimeBuckets(30);
      expect(result).toEqual([]);
    });

    it('should return daily buckets for recent snapshots', async () => {
      const db = await setupDb();
      const { getDailyUptimeBuckets } = await import('./status-page-store.js');

      // Insert a snapshot today
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (7, 2, 1, 2, 0, datetime('now'))
      `).run();

      const result = getDailyUptimeBuckets(30);
      expect(result.length).toBeGreaterThanOrEqual(1);
      // 7 running out of 10 total = 70%
      expect(result[result.length - 1].uptime_pct).toBe(70);
      expect(result[result.length - 1].date).toBeDefined();
    });

    it('should exclude snapshots older than the specified days', async () => {
      const db = await setupDb();
      const { getDailyUptimeBuckets } = await import('./status-page-store.js');

      // Old snapshot (60 days ago) — should be excluded from a 30-day query
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (0, 10, 0, 0, 2, datetime('now', '-60 days'))
      `).run();

      // Recent snapshot (2 days ago) — should be included
      db.prepare(`
        INSERT INTO monitoring_snapshots
          (containers_running, containers_stopped, containers_unhealthy, endpoints_up, endpoints_down, created_at)
        VALUES (10, 0, 0, 2, 0, datetime('now', '-2 days'))
      `).run();

      const result = getDailyUptimeBuckets(30);
      // Only the recent snapshot should be in the results
      expect(result).toHaveLength(1);
      expect(result[0].uptime_pct).toBe(100);
    });

    it('should not throw with the fixed parameter binding (regression)', async () => {
      await setupDb();
      const { getDailyUptimeBuckets } = await import('./status-page-store.js');

      expect(() => getDailyUptimeBuckets(7)).not.toThrow();
      expect(() => getDailyUptimeBuckets(30)).not.toThrow();
      expect(() => getDailyUptimeBuckets(90)).not.toThrow();
    });
  });
});
