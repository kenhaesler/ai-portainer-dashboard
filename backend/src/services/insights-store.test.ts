import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrepare = vi.fn();
const mockDb = { prepare: mockPrepare, transaction: vi.fn() };

vi.mock('../db/sqlite.js', () => ({
  getDb: () => mockDb,
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
    it('inserts a single insight', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      insertInsight(makeInsight());

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO insights'));
      expect(mockRun).toHaveBeenCalledWith(
        'test-id-1', 1, 'local', 'c1', 'web-app',
        'warning', 'anomaly', 'High CPU on "web-app"', 'CPU is high', null,
      );
    });
  });

  describe('insertInsights (batch)', () => {
    it('inserts multiple insights in a transaction', () => {
      const mockRun = vi.fn();
      const mockGet = vi.fn().mockReturnValue({ cnt: 0 });
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('INSERT')) return { run: mockRun };
        if (sql.includes('SELECT COUNT')) return { get: mockGet };
        return { run: vi.fn(), get: vi.fn() };
      });
      // Transaction mock: execute the callback immediately
      mockDb.transaction.mockImplementation((fn: () => void) => fn);

      const insights = [
        makeInsight({ id: 'id-1' }),
        makeInsight({ id: 'id-2', container_id: 'c2', container_name: 'api' }),
      ];

      const inserted = insertInsights(insights);

      expect(inserted).toBe(2);
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it('deduplicates insights with same container_id, category, title within 60min', () => {
      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ cnt: 1 }) // first insight is a duplicate
        .mockReturnValueOnce({ cnt: 0 }); // second is unique
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('INSERT')) return { run: mockRun };
        if (sql.includes('SELECT COUNT')) return { get: mockGet };
        return { run: vi.fn(), get: vi.fn() };
      });
      mockDb.transaction.mockImplementation((fn: () => void) => fn);

      const insights = [
        makeInsight({ id: 'dup-1' }),
        makeInsight({ id: 'unique-1', container_id: 'c2' }),
      ];

      const inserted = insertInsights(insights);

      expect(inserted).toBe(1);
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('skips deduplication for insights without container_id', () => {
      const mockRun = vi.fn();
      const mockGet = vi.fn();
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('INSERT')) return { run: mockRun };
        if (sql.includes('SELECT COUNT')) return { get: mockGet };
        return { run: vi.fn(), get: vi.fn() };
      });
      mockDb.transaction.mockImplementation((fn: () => void) => fn);

      const insights = [
        makeInsight({ id: 'no-container', container_id: null }),
      ];

      const inserted = insertInsights(insights);

      expect(inserted).toBe(1);
      // Dedup query should NOT be called for null container_id
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('returns 0 for empty array', () => {
      const inserted = insertInsights([]);
      expect(inserted).toBe(0);
    });
  });

  describe('getRecentInsights', () => {
    it('applies LIMIT parameter', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      getRecentInsights(60, 100);

      expect(mockAll).toHaveBeenCalledWith('-60', 100);
    });

    it('defaults limit to 500', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      getRecentInsights(30);

      expect(mockAll).toHaveBeenCalledWith('-30', 500);
    });
  });

  describe('cleanupOldInsights', () => {
    it('deletes insights older than retention days', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 42 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const deleted = cleanupOldInsights(7);

      expect(deleted).toBe(42);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM insights'));
      expect(mockRun).toHaveBeenCalledWith('-7');
    });

    it('returns 0 when nothing to delete', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const deleted = cleanupOldInsights(30);
      expect(deleted).toBe(0);
    });
  });
});
