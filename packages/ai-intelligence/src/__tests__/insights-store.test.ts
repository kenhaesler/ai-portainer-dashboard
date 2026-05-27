import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

// Kept: app-db-router mock — redirects to test PostgreSQL instance
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import {
  insertInsight,
  insertInsights,
  getRecentInsights,
  cleanupOldInsights,
  type InsightInsert,
} from '../services/insights-store.js';

function makeInsight(overrides: Partial<InsightInsert> = {}): InsightInsert {
  return {
    id: 'test-id-1',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'c1',
    container_name: 'web-app',
    severity: 'warning',
    category: 'anomaly',
    title: 'High CPU on "web-app"',
    description: 'CPU is high',
    suggested_action: null,
    ...overrides,
  };
}

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => { await truncateTestTables('insights'); });

describe('insights-store', () => {
  describe('insertInsight', () => {
    it('inserts a single insight', async () => {
      const insight = makeInsight();
      await insertInsight(insight);

      const rows = await testDb.query<{ id: string }>('SELECT id FROM insights WHERE id = ?', [insight.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(insight.id);
    });

    it('stores all fields correctly', async () => {
      const insight = makeInsight({ suggested_action: 'Scale up' });
      await insertInsight(insight);

      const rows = await testDb.query<Record<string, unknown>>(
        'SELECT * FROM insights WHERE id = ?',
        [insight.id],
      );
      expect(rows[0].endpoint_id).toBe(1);
      expect(rows[0].container_name).toBe('web-app');
      expect(rows[0].severity).toBe('warning');
      expect(rows[0].category).toBe('anomaly');
      expect(rows[0].suggested_action).toBe('Scale up');
      expect(rows[0].is_acknowledged).toBe(false);
    });
  });

  describe('insertInsights (batch)', () => {
    it('inserts multiple insights in a transaction and returns their IDs', async () => {
      const insights = [
        makeInsight({ id: 'id-1' }),
        makeInsight({ id: 'id-2', container_id: 'c2', container_name: 'api' }),
      ];

      const insertedIds = await insertInsights(insights);

      expect(insertedIds).toBeInstanceOf(Set);
      expect(insertedIds.size).toBe(2);
      expect(insertedIds.has('id-1')).toBe(true);
      expect(insertedIds.has('id-2')).toBe(true);

      const rows = await testDb.query('SELECT id FROM insights ORDER BY id', []);
      expect(rows).toHaveLength(2);
    });

    it('deduplicates insights with same container_id/category/title within 60 minutes', async () => {
      // Pre-insert to create the duplicate condition
      await insertInsight(makeInsight({ id: 'original-1' }));

      const insights = [
        makeInsight({ id: 'dup-1' }),               // same container_id/category/title → skipped
        makeInsight({ id: 'unique-1', container_id: 'c2' }), // different container_id → inserted
      ];

      const insertedIds = await insertInsights(insights);

      expect(insertedIds).toBeInstanceOf(Set);
      expect(insertedIds.size).toBe(1);
      expect(insertedIds.has('dup-1')).toBe(false);
      expect(insertedIds.has('unique-1')).toBe(true);

      const rows = await testDb.query<{ id: string }>('SELECT id FROM insights ORDER BY id', []);
      expect(rows).toHaveLength(2); // original-1 + unique-1
    });

    it('deduplicates predictions whose title carries a refining ETA, by (category, metric_type, detection_method)', async () => {
      const first: InsightInsert = makeInsight({
        id: 'pred-1',
        category: 'predictive',
        metric_type: 'memory',
        detection_method: 'prediction',
        title: 'Predicted memory exhaustion on "web-app" ~24h',
      });
      const second: InsightInsert = makeInsight({
        id: 'pred-2',
        category: 'predictive',
        metric_type: 'memory',
        detection_method: 'prediction',
        title: 'Predicted memory exhaustion on "web-app" ~20h',
      });

      const insertedIds = await insertInsights([first]);
      expect(insertedIds.has('pred-1')).toBe(true);

      const insertedIdsAgain = await insertInsights([second]);
      expect(insertedIdsAgain.has('pred-2')).toBe(false);

      const rows = await testDb.query<{ id: string }>('SELECT id FROM insights WHERE container_id = ?', ['c1']);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('pred-1');
    });

    it('does NOT dedupe when category matches but metric_type differs (CPU prediction vs memory prediction)', async () => {
      const cpu: InsightInsert = makeInsight({
        id: 'pred-cpu', category: 'predictive', metric_type: 'cpu', detection_method: 'prediction',
        title: 'Predicted CPU exhaustion on "web-app"',
      });
      const memory: InsightInsert = makeInsight({
        id: 'pred-mem', category: 'predictive', metric_type: 'memory', detection_method: 'prediction',
        title: 'Predicted memory exhaustion on "web-app"',
      });

      await insertInsights([cpu]);
      await insertInsights([memory]);

      const rows = await testDb.query<{ id: string }>(
        'SELECT id FROM insights WHERE container_id = ? ORDER BY id',
        ['c1'],
      );
      expect(rows.map((r) => r.id).sort()).toEqual(['pred-cpu', 'pred-mem']);
    });

    it('falls back to title-based dedup when metric_type and detection_method are both null (legacy insights)', async () => {
      const first: InsightInsert = makeInsight({
        id: 'leg-1',
        category: 'security',
        title: 'Vulnerable image: foo:1.2.3',
      });
      const second: InsightInsert = makeInsight({
        id: 'leg-2',
        category: 'security',
        title: 'Vulnerable image: foo:1.2.3',
      });
      const different: InsightInsert = makeInsight({
        id: 'leg-3',
        category: 'security',
        title: 'Vulnerable image: bar:9.9.9',
      });

      await insertInsights([first]);
      await insertInsights([second]);
      await insertInsights([different]);

      const rows = await testDb.query<{ id: string }>(
        'SELECT id FROM insights WHERE container_id = ? ORDER BY id',
        ['c1'],
      );
      expect(rows.map((r) => r.id).sort()).toEqual(['leg-1', 'leg-3']);
    });

    it('skips deduplication for insights without container_id', async () => {
      const insights = [makeInsight({ id: 'no-container', container_id: null })];

      const insertedIds = await insertInsights(insights);

      expect(insertedIds).toBeInstanceOf(Set);
      expect(insertedIds.size).toBe(1);
      expect(insertedIds.has('no-container')).toBe(true);
    });

    it('returns empty set for empty array', async () => {
      const insertedIds = await insertInsights([]);
      expect(insertedIds).toBeInstanceOf(Set);
      expect(insertedIds.size).toBe(0);
    });

    it('persists the `dimensions` JSONB payload for correlated anomalies (#1296)', async () => {
      const correlated: InsightInsert = makeInsight({
        id: 'corr-1',
        container_id: 'svc-api',
        container_name: 'api',
        title: 'Correlated anomaly on service "api" (error_rate + latency_p95)',
        metric_type: 'latency_p95',
        detection_method: 'ml-anomaly',
        dimensions: [
          { type: 'latency_p95', value: 820, baseline: 21, zScore: 4.3, severity: 'critical' },
          { type: 'error_rate', value: 0.08, baseline: 0.004, zScore: 1.6, severity: 'warning' },
        ],
      });

      const insertedIds = await insertInsights([correlated]);
      expect(insertedIds.has('corr-1')).toBe(true);

      const rows = await testDb.query<{ dimensions: unknown }>(
        'SELECT dimensions FROM insights WHERE id = ?',
        ['corr-1'],
      );
      expect(rows).toHaveLength(1);
      // pg driver decodes JSONB into a JS object; normalise to compare.
      const raw = rows[0].dimensions;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      expect(parsed).toEqual([
        { type: 'latency_p95', value: 820, baseline: 21, zScore: 4.3, severity: 'critical' },
        { type: 'error_rate', value: 0.08, baseline: 0.004, zScore: 1.6, severity: 'warning' },
      ]);
    });

    it('stores NULL `dimensions` for legacy single-dimension records', async () => {
      await insertInsights([makeInsight({ id: 'legacy-1' })]);
      const rows = await testDb.query<{ dimensions: unknown }>(
        'SELECT dimensions FROM insights WHERE id = ?',
        ['legacy-1'],
      );
      expect(rows[0].dimensions).toBeNull();
    });
  });

  describe('getRecentInsights', () => {
    it('returns insights within the specified time window', async () => {
      await insertInsight(makeInsight({ id: 'recent-1' }));
      const results = await getRecentInsights(60);
      expect(results.some((r) => r.id === 'recent-1')).toBe(true);
    });

    it('applies LIMIT parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await insertInsight(makeInsight({ id: `insight-${i}`, container_id: `c${i}` }));
      }
      const results = await getRecentInsights(60, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('defaults limit to 500', async () => {
      await insertInsight(makeInsight({ id: 'default-limit-test' }));
      const results = await getRecentInsights(30);
      expect(results.length).toBeLessThanOrEqual(500);
      expect(results.some((r) => r.id === 'default-limit-test')).toBe(true);
    });
  });

  describe('cleanupOldInsights', () => {
    it('deletes insights older than retention days', async () => {
      // Insert directly with a timestamp 8 days in the past
      await testDb.execute(
        `INSERT INTO insights (
          id, endpoint_id, endpoint_name, container_id, container_name,
          severity, category, title, description, suggested_action,
          is_acknowledged, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW() - INTERVAL '8 days')`,
        ['old-insight', 1, 'local', 'c1', 'web-app', 'warning', 'anomaly', 'Old Issue', 'Old desc', null],
      );

      const deleted = await cleanupOldInsights(7);
      expect(deleted).toBe(1);
    });

    it('does not delete insights within retention period', async () => {
      await insertInsight(makeInsight({ id: 'fresh-insight' }));

      const deleted = await cleanupOldInsights(7);
      expect(deleted).toBe(0);
    });

    it('returns 0 when nothing to delete', async () => {
      const deleted = await cleanupOldInsights(30);
      expect(deleted).toBe(0);
    });
  });
});
