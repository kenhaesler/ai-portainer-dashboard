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

const DEFAULT_URL = 'postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test';

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

async function runMigrations(db: pg.Pool): Promise<void> {
  await db.query(`
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

  const { rows } = await db.query('SELECT name FROM _app_migrations');
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
      await db.query(stmt.endsWith(';') ? stmt : stmt + ';');
    }

    await db.query('INSERT INTO _app_migrations (name) VALUES ($1)', [file]);
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
