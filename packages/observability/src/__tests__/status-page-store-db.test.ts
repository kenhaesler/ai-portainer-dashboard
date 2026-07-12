/**
 * DB-backed regression tests for status-page-store (#1526, #1506).
 *
 * pg returns uncast SUM()/COUNT() aggregates as strings (bigint), which broke
 * the `total === 0` guards and produced NaN uptime on the public status page
 * when a window contained no monitoring_snapshots rows. These tests run the
 * real queries against an EMPTY table (and a seeded one) to pin the fix.
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
 *   npx vitest run src/__tests__/status-page-store-db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import {
  getStatusPageConfig,
  getOverallUptime,
  getEndpointUptime,
  getUptimeSummary,
  getDailyUptimeBuckets,
} from '../services/status-page-store.js';

async function seedSnapshot(opts: {
  running: number;
  stopped: number;
  unhealthy: number;
  up: number;
  down: number;
  hoursAgo: number;
}): Promise<void> {
  await testDb.execute(
    `INSERT INTO monitoring_snapshots (
      containers_running, containers_stopped, containers_unhealthy,
      endpoints_up, endpoints_down, created_at
    ) VALUES (?, ?, ?, ?, ?, NOW() - make_interval(hours => ?))`,
    [opts.running, opts.stopped, opts.unhealthy, opts.up, opts.down, opts.hoursAgo],
  );
}

describe('status-page-store (real PostgreSQL)', () => {
  beforeAll(async () => {
    testDb = await getTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('monitoring_snapshots', 'settings');
  });

  describe('empty monitoring_snapshots table (#1526 regression)', () => {
    it('getOverallUptime returns 100, never NaN', async () => {
      for (const hours of [24, 168, 720]) {
        const result = await getOverallUptime(hours);
        expect(result).toBe(100);
        expect(Number.isFinite(result)).toBe(true);
      }
    });

    it('getEndpointUptime returns 100, never NaN', async () => {
      for (const hours of [24, 168, 720]) {
        const result = await getEndpointUptime(hours);
        expect(result).toBe(100);
        expect(Number.isFinite(result)).toBe(true);
      }
    });

    it('getUptimeSummary returns 100 for all windows and serializes without null', async () => {
      const summary = await getUptimeSummary();

      expect(summary).toEqual({
        containers: { '24h': 100, '7d': 100, '30d': 100 },
        endpoints: { '24h': 100, '7d': 100, '30d': 100 },
      });
      // NaN would serialize to null in the public JSON payload
      expect(JSON.stringify(summary)).not.toContain('null');
    });

    it('getDailyUptimeBuckets returns an empty array', async () => {
      expect(await getDailyUptimeBuckets(90)).toEqual([]);
    });
  });

  describe('seeded monitoring_snapshots', () => {
    beforeEach(async () => {
      // Two snapshots within the last 24h (same hour so they share a DATE bucket)
      await seedSnapshot({ running: 8, stopped: 2, unhealthy: 0, up: 3, down: 1, hoursAgo: 1 });
      await seedSnapshot({ running: 8, stopped: 2, unhealthy: 0, up: 3, down: 1, hoursAgo: 1 });
      // One older snapshot only visible in the 7d/30d windows
      await seedSnapshot({ running: 0, stopped: 10, unhealthy: 0, up: 0, down: 4, hoursAgo: 48 });
    });

    it('getOverallUptime returns real numbers per window', async () => {
      // 24h: 16 running / 20 total
      expect(await getOverallUptime(24)).toBe(80);
      // 7d: 16 running / 30 total
      expect(await getOverallUptime(168)).toBe(53.33);
    });

    it('getEndpointUptime returns real numbers per window', async () => {
      // 24h: 6 up / 8 total
      expect(await getEndpointUptime(24)).toBe(75);
      // 7d: 6 up / 12 total
      expect(await getEndpointUptime(168)).toBe(50);
    });

    it('getUptimeSummary matches the individual window queries in one round-trip', async () => {
      const summary = await getUptimeSummary();

      expect(summary).toEqual({
        containers: { '24h': 80, '7d': 53.33, '30d': 53.33 },
        endpoints: { '24h': 75, '7d': 50, '30d': 50 },
      });
    });

    it('getDailyUptimeBuckets returns finite numeric percentages', async () => {
      const buckets = await getDailyUptimeBuckets(90);

      expect(buckets).toHaveLength(2);
      for (const bucket of buckets) {
        expect(typeof bucket.uptime_pct).toBe('number');
        expect(Number.isFinite(bucket.uptime_pct)).toBe(true);
      }
      // Older day: 0/10 running; newer day: 16/20 running
      expect(buckets[0].uptime_pct).toBe(0);
      expect(buckets[1].uptime_pct).toBe(80);
    });
  });

  describe('getStatusPageConfig (batched settings query, #1506)', () => {
    it('returns defaults from an empty settings table', async () => {
      expect(await getStatusPageConfig()).toEqual({
        enabled: false,
        title: 'System Status',
        description: '',
        showIncidents: true,
        autoRefreshSeconds: 30,
      });
    });

    it('reads stored settings in a single batch', async () => {
      await testDb.execute(
        `INSERT INTO settings (key, value, category, updated_at) VALUES
         ('status.page.enabled', 'true', 'status_page', NOW()),
         ('status.page.title', 'Fleet Status', 'status_page', NOW()),
         ('status.page.show_incidents', 'false', 'status_page', NOW()),
         ('status.page.refresh_interval', '60', 'status_page', NOW())`,
      );

      expect(await getStatusPageConfig()).toEqual({
        enabled: true,
        title: 'Fleet Status',
        description: '',
        showIncidents: false,
        autoRefreshSeconds: 60,
      });
    });
  });
});
