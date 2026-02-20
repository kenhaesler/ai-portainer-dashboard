import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTestDb, getTestPool, closeTestDb } from './test-db-helper.js';
import type { AppDb } from './app-db.js';
import type pg from 'pg';

let appDb: AppDb;
let pool: pg.Pool;

beforeAll(async () => {
  appDb = await getTestDb();
  pool = await getTestPool();
});

afterAll(async () => {
  await closeTestDb();
});

describe('PostgreSQL App Database', () => {
  it('creates connection pool successfully', async () => {
    // Verify pool is initialized
    expect(pool).toBeDefined();
    expect(appDb).toBeDefined();
  });

  it('runs migrations and creates _app_migrations table', async () => {
    const { rows } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = '_app_migrations'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].table_name).toBe('_app_migrations');
  });

  it('records applied migrations in _app_migrations table', async () => {
    const { rows } = await pool.query(`
      SELECT name
      FROM _app_migrations
      ORDER BY id
    `);

    // Should have at least the first few migrations
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].name).toMatch(/^\d{3}_.*\.sql$/);
  });

  it('creates all expected tables from migrations', async () => {
    // Get all actual tables (excluding internal _app_migrations)
    const { rows: actualTables } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name NOT LIKE '\\_%'
      ORDER BY table_name
    `);

    const actual = actualTables.map((r: { table_name: string }) => r.table_name);

    // Core tables from migrations (at least these should exist)
    const expectedCore = [
      'sessions',
      'settings',
      'insights',
      'actions',
      'spans',
      'audit_log',
      'investigations',
      'notification_log',
      'monitoring_cycles',
      'monitoring_snapshots',
      'webhooks',
      'pcap_captures',
      'incidents',
      'users',
      'llm_traces',
      'ebpf_coverage',
      'mcp_servers',
      'prompt_profiles',
      'llm_feedback',
      'image_staleness',
      'kpi_snapshots',
    ];

    // Verify all core tables exist
    for (const table of expectedCore) {
      expect(actual).toContain(table);
    }

    // Should have at least the core tables
    expect(actual.length).toBeGreaterThanOrEqual(expectedCore.length);
  });

  it('health check returns true for healthy connection', async () => {
    const result = await appDb.healthCheck();
    expect(result).toBe(true);
  });

  it('executes queries successfully', async () => {
    const result = await appDb.query('SELECT 1 as test');
    expect(result).toHaveLength(1);
    expect(result[0].test).toBe(1);
  });

  it('executes queryOne successfully', async () => {
    const result = await appDb.queryOne('SELECT 42 as answer');
    expect(result).toBeDefined();
    expect(result?.answer).toBe(42);
  });

  it('queryOne returns null when no rows match', async () => {
    const result = await appDb.queryOne('SELECT 1 WHERE false');
    expect(result).toBeNull();
  });

  it('executes INSERT/UPDATE/DELETE statements', async () => {
    // Create a test table
    await pool.query(`
      CREATE TEMP TABLE test_execute (
        id SERIAL PRIMARY KEY,
        value TEXT
      )
    `);

    const insertResult = await appDb.execute(
      'INSERT INTO test_execute (value) VALUES (?)',
      ['test-value']
    );

    expect(insertResult.changes).toBe(1);

    const updateResult = await appDb.execute(
      'UPDATE test_execute SET value = ? WHERE value = ?',
      ['updated', 'test-value']
    );

    expect(updateResult.changes).toBe(1);

    const deleteResult = await appDb.execute(
      'DELETE FROM test_execute WHERE value = ?',
      ['updated']
    );

    expect(deleteResult.changes).toBe(1);
  });

  it('handles transactions with commit', async () => {
    await pool.query(`
      CREATE TEMP TABLE test_transaction (
        id SERIAL PRIMARY KEY,
        value TEXT
      )
    `);

    const result = await appDb.transaction(async (txDb) => {
      await txDb.execute('INSERT INTO test_transaction (value) VALUES (?)', ['tx1']);
      await txDb.execute('INSERT INTO test_transaction (value) VALUES (?)', ['tx2']);
      return 'success';
    });

    expect(result).toBe('success');

    const { rows } = await pool.query('SELECT COUNT(*) as count FROM test_transaction');
    expect(rows[0].count).toBe('2'); // pg returns bigint as string
  });

  it('handles transactions with rollback on error', async () => {
    await pool.query(`
      CREATE TEMP TABLE test_rollback (
        id SERIAL PRIMARY KEY,
        value TEXT
      )
    `);

    await expect(async () => {
      await appDb.transaction(async (txDb) => {
        await txDb.execute('INSERT INTO test_rollback (value) VALUES (?)', ['before-error']);
        throw new Error('Intentional rollback');
      });
    }).rejects.toThrow('Intentional rollback');

    const { rows } = await pool.query('SELECT COUNT(*) as count FROM test_rollback');
    expect(rows[0].count).toBe('0'); // Transaction was rolled back
  });

  it('converts ? placeholders to $N format', async () => {
    const result = await appDb.query(
      'SELECT ? as first, ? as second, ? as third',
      [1, 2, 3]
    );

    expect(result).toHaveLength(1);
    // PostgreSQL returns SELECT literal integers as strings
    expect(result[0].first).toBe('1');
    expect(result[0].second).toBe('2');
    expect(result[0].third).toBe('3');
  });

  it('handles empty string literals in SQL', async () => {
    // Regression test for convertPlaceholders() bug with '' literals
    const result = await appDb.query(
      "SELECT COALESCE(NULLIF(?, ''), 'default') as value",
      ['']
    );

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('default');
  });
});

// Mock app-db-router to use test pool
// Kept: app-db-router mock — redirects to test PostgreSQL instance
vi.mock('./app-db-router.js', async () => {
  const { getTestDb } = await import('./test-db-helper.js');
  return {
    getDbForDomain: async () => getTestDb(),
  };
});
