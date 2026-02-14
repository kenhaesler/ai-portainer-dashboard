import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTransaction = vi.fn();
const mockDb = {
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
  healthCheck: vi.fn(),
};

vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => mockDb,
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
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

describe('insights-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertInsight', () => {
    it('inserts a single insight', async () => {
      mockExecute.mockResolvedValue({ changes: 1 });

      await insertInsight(makeInsight());

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO insights'),
        [
          'test-id-1', 1, 'local', 'c1', 'web-app',
          'warning', 'anomaly', 'High CPU on "web-app"', 'CPU is high', null,
        ],
      );
    });
  });

  describe('insertInsights (batch)', () => {
    it('inserts multiple insights in a transaction', async () => {
      // Transaction mock: call the callback with a transactional db mock
      const txExecute = vi.fn().mockResolvedValue({ changes: 1 });
      const txQueryOne = vi.fn().mockResolvedValue({ cnt: 0 });
      const txDb = { execute: txExecute, query: vi.fn(), queryOne: txQueryOne, transaction: vi.fn(), healthCheck: vi.fn() };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<number>) => fn(txDb));

      const insights = [
        makeInsight({ id: 'id-1' }),
        makeInsight({ id: 'id-2', container_id: 'c2', container_name: 'api' }),
      ];

      const inserted = await insertInsights(insights);

      expect(inserted).toBe(2);
      expect(txExecute).toHaveBeenCalledTimes(2);
    });

    it('deduplicates insights with same container_id, category, title within 60min', async () => {
      const txExecute = vi.fn().mockResolvedValue({ changes: 1 });
      const txQueryOne = vi.fn()
        .mockResolvedValueOnce({ cnt: 1 }) // first insight is a duplicate
        .mockResolvedValueOnce({ cnt: 0 }); // second is unique
      const txDb = { execute: txExecute, query: vi.fn(), queryOne: txQueryOne, transaction: vi.fn(), healthCheck: vi.fn() };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<number>) => fn(txDb));

      const insights = [
        makeInsight({ id: 'dup-1' }),
        makeInsight({ id: 'unique-1', container_id: 'c2' }),
      ];

      const inserted = await insertInsights(insights);

      expect(inserted).toBe(1);
      expect(txExecute).toHaveBeenCalledTimes(1);
    });

    it('skips deduplication for insights without container_id', async () => {
      const txExecute = vi.fn().mockResolvedValue({ changes: 1 });
      const txQueryOne = vi.fn();
      const txDb = { execute: txExecute, query: vi.fn(), queryOne: txQueryOne, transaction: vi.fn(), healthCheck: vi.fn() };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<number>) => fn(txDb));

      const insights = [
        makeInsight({ id: 'no-container', container_id: null }),
      ];

      const inserted = await insertInsights(insights);

      expect(inserted).toBe(1);
      // Dedup query should NOT be called for null container_id
      expect(txQueryOne).not.toHaveBeenCalled();
    });

    it('returns 0 for empty array', async () => {
      const inserted = await insertInsights([]);
      expect(inserted).toBe(0);
    });
  });

  describe('getRecentInsights', () => {
    it('applies LIMIT parameter', async () => {
      mockQuery.mockResolvedValue([]);

      await getRecentInsights(60, 100);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        ['-60', 100],
      );
    });

    it('defaults limit to 500', async () => {
      mockQuery.mockResolvedValue([]);

      await getRecentInsights(30);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        ['-30', 500],
      );
    });
  });

  describe('cleanupOldInsights', () => {
    it('deletes insights older than retention days', async () => {
      mockExecute.mockResolvedValue({ changes: 42 });

      const deleted = await cleanupOldInsights(7);

      expect(deleted).toBe(42);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM insights'),
        ['-7'],
      );
    });

    it('returns 0 when nothing to delete', async () => {
      mockExecute.mockResolvedValue({ changes: 0 });

      const deleted = await cleanupOldInsights(30);
      expect(deleted).toBe(0);
    });
  });
});
