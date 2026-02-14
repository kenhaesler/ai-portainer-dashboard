import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createChildLogger('postgres-app');

// Return ISO strings for timestamps (same as timescale.ts)
pg.types.setTypeParser(1184, (val: string) => new Date(val).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (val: string) => new Date(val + 'Z').toISOString()); // timestamp

let pool: pg.Pool | null = null;
let migrationsReady = false;

/**
 * Returns true if the app PostgreSQL pool is connected and migrations have been applied.
 */
export function isAppDbReady(): boolean {
  return pool !== null && migrationsReady;
}

/**
 * Returns the app PostgreSQL pool, creating it on first call.
 * Auto-runs migrations from `postgres-migrations/` directory.
 */
export async function getAppDb(): Promise<pg.Pool> {
  if (!pool) {
    const config = getConfig();

    const newPool = new pg.Pool({
      connectionString: config.POSTGRES_APP_URL,
      max: config.POSTGRES_APP_MAX_CONNECTIONS,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    newPool.on('error', (err) => {
      log.error({ err }, 'Unexpected app PostgreSQL pool error');
    });

    log.info('App PostgreSQL pool created');

    try {
      await runMigrations(newPool);
      migrationsReady = true;
    } catch (err) {
      log.error({ err }, 'App PostgreSQL migrations failed — pool will be retried on next call');
      await newPool.end().catch(() => {});
      throw err;
    }

    pool = newPool;
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
  if (!fs.existsSync(migrationsDir)) {
    log.info('No postgres-migrations directory found, skipping');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await db.query('SELECT name FROM _app_migrations');
  const applied = new Set(rows.map((row: { name: string }) => row.name));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    log.info({ migration: file }, 'Applying app PostgreSQL migration');

    // Execute each statement individually to avoid implicit transaction wrapping
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => {
        return s.split('\n').some((line) => {
          const t = line.trim();
          return t.length > 0 && !t.startsWith('--');
        });
      });

    for (const stmt of statements) {
      await db.query(stmt.endsWith(';') ? stmt : stmt + ';');
    }

    await db.query('INSERT INTO _app_migrations (name) VALUES ($1)', [file]);

    log.info({ migration: file }, 'App PostgreSQL migration applied');
  }
}

export async function closeAppDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    migrationsReady = false;
    log.info('App PostgreSQL pool closed');
  }
}

export async function isAppDbHealthy(): Promise<boolean> {
  try {
    const db = await getAppDb();
    const { rows } = await db.query('SELECT 1 as ok');
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
