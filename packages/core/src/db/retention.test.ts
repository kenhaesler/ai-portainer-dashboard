/**
 * Real-PostgreSQL tests for the batched retention delete (#1505).
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:...@localhost:5434/portainer_dashboard_test \
 *   npx vitest run src/db/retention.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from './test-db-helper.js';
import type { AppDb } from './app-db.js';
import { batchedDeleteOlderThan } from './retention.js';

// Redirect getDbForDomain to the test database (audit-logger resolves it lazily).
let testDb: AppDb;
vi.mock('./app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { cleanOldAuditLogs } from '../services/audit-logger.js';

async function seedAuditRow(action: string, daysAgo: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO audit_log (action, created_at)
     VALUES (?, NOW() - make_interval(days => ?))`,
    [action, daysAgo],
  );
}

async function countAuditRows(): Promise<number> {
  const row = await testDb.queryOne<{ count: number }>(
    'SELECT COUNT(*)::integer as count FROM audit_log',
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  testDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('audit_log');
});

describe('batchedDeleteOlderThan (real PostgreSQL)', () => {
  it('deletes only rows older than the window', async () => {
    await seedAuditRow('old-1', 100);
    await seedAuditRow('old-2', 91);
    await seedAuditRow('recent', 5);
    await seedAuditRow('today', 0);

    const deleted = await batchedDeleteOlderThan(testDb, 'audit_log', 'created_at', 90);

    expect(deleted).toBe(2);
    expect(await countAuditRows()).toBe(2);
    const remaining = await testDb.query<{ action: string }>(
      'SELECT action FROM audit_log ORDER BY action',
    );
    expect(remaining.map((r) => r.action)).toEqual(['recent', 'today']);
  });

  it('loops across batches until the table is clean', async () => {
    for (let i = 0; i < 5; i++) {
      await seedAuditRow(`old-${i}`, 40);
    }
    await seedAuditRow('recent', 1);

    // batchSize 2 forces three delete round-trips (2 + 2 + 1)
    const deleted = await batchedDeleteOlderThan(testDb, 'audit_log', 'created_at', 30, 2);

    expect(deleted).toBe(5);
    expect(await countAuditRows()).toBe(1);
  });

  it('returns 0 when nothing is old enough', async () => {
    await seedAuditRow('recent', 3);

    const deleted = await batchedDeleteOlderThan(testDb, 'audit_log', 'created_at', 30);

    expect(deleted).toBe(0);
    expect(await countAuditRows()).toBe(1);
  });

  it('rejects non-positive and non-integer day windows', async () => {
    await expect(batchedDeleteOlderThan(testDb, 'audit_log', 'created_at', 0)).rejects.toThrow(/positive integer/);
    await expect(batchedDeleteOlderThan(testDb, 'audit_log', 'created_at', 1.5)).rejects.toThrow(/positive integer/);
  });

  it('rejects identifiers that are not plain lowercase names', async () => {
    await expect(
      batchedDeleteOlderThan(testDb, 'audit_log; DROP TABLE users', 'created_at', 30),
    ).rejects.toThrow(/invalid identifier/);
    await expect(
      batchedDeleteOlderThan(testDb, 'audit_log', 'created_at OR 1=1', 30),
    ).rejects.toThrow(/invalid identifier/);
  });
});

describe('cleanOldAuditLogs (#1505)', () => {
  it('prunes audit entries past the retention window', async () => {
    await seedAuditRow('login', 120);
    await seedAuditRow('settings.update', 10);

    const deleted = await cleanOldAuditLogs(90);

    expect(deleted).toBe(1);
    const remaining = await testDb.query<{ action: string }>('SELECT action FROM audit_log');
    expect(remaining.map((r) => r.action)).toEqual(['settings.update']);
  });
});

describe('migration 039 — webhook_deliveries created_at index', () => {
  it('creates idx_webhook_deliveries_created_at', async () => {
    const pool = await getTestPool();
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'webhook_deliveries' AND indexname = 'idx_webhook_deliveries_created_at'`,
    );
    expect(rows).toHaveLength(1);
  });
});
