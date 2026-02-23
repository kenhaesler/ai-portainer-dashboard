import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../core/db/test-db-helper.js';
import type { AppDb } from '../core/db/app-db.js';

let testDb: AppDb;

// Kept: app-db-router mock — redirects to test PostgreSQL instance
vi.mock('../core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import {
  insertInsight,
  insertInsights,
  getRecentInsights,
  cleanupOldInsights,
  type InsightInsert,
} from './insights-store.js';

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
