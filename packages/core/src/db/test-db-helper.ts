/**
 * Test helper — connects to a real PostgreSQL instance and runs production migrations.
 *
 * Usage:
 *   import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
 *
 *   let appDb: AppDb;
 *   beforeAll(async () => { appDb = await getTestDb(); });
 *   afterAll(async () => { await closeTestDb(); });
 *   beforeEach(async () => { await truncateTestTables('spans'); });
 *
 * Set POSTGRES_TEST_URL to override the default connection string.
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PostgresAdapter } from './postgres-adapter.js';
import type { AppDb } from './app-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Return ISO strings for timestamps (same as production postgres.ts)
pg.types.setTypeParser(1184, (val: string) => new Date(val).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (val: string) => new Date(val + 'Z').toISOString()); // timestamp

// Build connection URL from individual env vars (safe defaults for local dev).
// POSTGRES_TEST_URL still takes full precedence (see ensurePool below).
const PGUSER = process.env.POSTGRES_TEST_USER ?? 'app_user';
const PGPASSWORD = process.env.POSTGRES_TEST_PASSWORD ?? process.env.POSTGRES_APP_PASSWORD ?? 'changeme-postgres-app';
const PGHOST = process.env.POSTGRES_TEST_HOST ?? 'localhost';
const PGPORT = process.env.POSTGRES_TEST_PORT ?? '5433';
const PGDATABASE = process.env.POSTGRES_TEST_DB ?? 'portainer_dashboard_test';

const DEFAULT_URL = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;

let pool: pg.Pool | null = null;
let adapter: PostgresAdapter | null = null;
let migrated = false;

async function ensurePool(): Promise<pg.Pool> {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.POSTGRES_TEST_URL ?? DEFAULT_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

// Advisory lock ID for serializing migrations across parallel test processes.
// Arbitrary constant — must be consistent across all callers.
const MIGRATION_LOCK_ID = 839217;

async function runMigrations(db: pg.Pool): Promise<void> {
  // Acquire an advisory lock so parallel test processes (e.g. CI running
  // @dashboard/observability, @dashboard/security, etc. concurrently against
  // the same PostgreSQL instance) don't race on CREATE INDEX IF NOT EXISTS
  // which can fail with duplicate key errors on pg_class catalog tables.
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS _app_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, 'postgres-migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query('SELECT name FROM _app_migrations');
    const applied = new Set(rows.map((row: { name: string }) => row.name));

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      const statements = sql
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) =>
          s.split('\n').some((line) => {
            const t = line.trim();
            return t.length > 0 && !t.startsWith('--');
          }),
        );

      for (const stmt of statements) {
        await client.query(stmt.endsWith(';') ? stmt : stmt + ';');
      }

      await client.query('INSERT INTO _app_migrations (name) VALUES ($1)', [file]);
    }

    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  } catch (err) {
    // Release the lock even on failure
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns a real PostgresAdapter backed by the test database.
 * Runs production migrations on first call.
 */
export async function getTestDb(): Promise<AppDb> {
  const p = await ensurePool();
  if (!migrated) {
    await runMigrations(p);
    migrated = true;
  }
  if (!adapter) {
    adapter = new PostgresAdapter(p);
  }
  return adapter;
}

/**
 * Returns the raw pg.Pool for direct verification queries in tests.
 */
export async function getTestPool(): Promise<pg.Pool> {
  return ensurePool();
}

/**
 * Truncates the given tables for test isolation. Uses TRUNCATE ... CASCADE.
 */
export async function truncateTestTables(...tables: string[]): Promise<void> {
  const p = await ensurePool();
  await p.query(`TRUNCATE ${tables.join(', ')} CASCADE`);
}

/**
 * Closes the test pool. Call in afterAll.
 */
export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    adapter = null;
    migrated = false;
  }
}
