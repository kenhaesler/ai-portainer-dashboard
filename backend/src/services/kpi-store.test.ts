import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock sqlite to use in-memory database
let testDb: InstanceType<typeof Database>;

vi.mock('../db/sqlite.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { insertKpiSnapshot, getKpiHistory, cleanOldKpiSnapshots } from './kpi-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('KPI Store', () => {
  beforeAll(() => {
    testDb = new Database(':memory:');
    // Apply the migration
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '../db/migrations/013_kpi_snapshots.sql'),
      'utf-8',
    );
    testDb.exec(migrationSql);
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    testDb.exec('DELETE FROM kpi_snapshots');
  });

  describe('insertKpiSnapshot', () => {
    it('should insert a KPI snapshot', () => {
      insertKpiSnapshot({
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

      const rows = testDb.prepare('SELECT * FROM kpi_snapshots').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].endpoints).toBe(3);
      expect(rows[0].running).toBe(15);
      expect(rows[0].stopped).toBe(5);
      expect(rows[0].stacks).toBe(4);
    });

    it('should auto-set timestamp', () => {
      insertKpiSnapshot({
        endpoints: 1, endpoints_up: 1, endpoints_down: 0,
        running: 10, stopped: 0, healthy: 10, unhealthy: 0,
        total: 10, stacks: 2,
      });

      const rows = testDb.prepare('SELECT * FROM kpi_snapshots').all() as any[];
      expect(rows[0].timestamp).toBeDefined();
      expect(typeof rows[0].timestamp).toBe('string');
    });
  });

  describe('getKpiHistory', () => {
    it('should return snapshots from the last N hours', () => {
      // Insert a recent snapshot
      testDb.prepare(`
        INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
        VALUES (3, 2, 1, 15, 5, 12, 3, 20, 4, datetime('now', '-1 hour'))
      `).run();

      // Insert an old snapshot (outside 24h window)
      testDb.prepare(`
        INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
        VALUES (2, 2, 0, 10, 2, 10, 0, 12, 3, datetime('now', '-48 hours'))
      `).run();

      const history = getKpiHistory(24);
      expect(history).toHaveLength(1);
      expect(history[0].endpoints).toBe(3);
      expect(history[0].running).toBe(15);
    });

    it('should return empty array when no snapshots exist', () => {
      const history = getKpiHistory(24);
      expect(history).toEqual([]);
    });

    it('should return snapshots in ascending timestamp order', () => {
      testDb.prepare(`
        INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
        VALUES (1, 1, 0, 5, 0, 5, 0, 5, 1, datetime('now', '-2 hours'))
      `).run();
      testDb.prepare(`
        INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
        VALUES (2, 2, 0, 10, 0, 10, 0, 10, 2, datetime('now', '-1 hour'))
      `).run();

      const history = getKpiHistory(24);
      expect(history).toHaveLength(2);
      expect(history[0].endpoints).toBe(1);
      expect(history[1].endpoints).toBe(2);
    });
  });

  describe('cleanOldKpiSnapshots', () => {
    it('should delete snapshots older than retention period', () => {
      testDb.prepare(`
        INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
        VALUES (1, 1, 0, 5, 0, 5, 0, 5, 1, datetime('now', '-10 days'))
      `).run();
      testDb.prepare(`
        INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
        VALUES (2, 2, 0, 10, 0, 10, 0, 10, 2, datetime('now', '-1 hour'))
      `).run();

      const deleted = cleanOldKpiSnapshots(7);
      expect(deleted).toBe(1);

      const remaining = testDb.prepare('SELECT * FROM kpi_snapshots').all();
      expect(remaining).toHaveLength(1);
    });

    it('should return 0 when nothing to clean', () => {
      const deleted = cleanOldKpiSnapshots(7);
      expect(deleted).toBe(0);
    });
  });
});
