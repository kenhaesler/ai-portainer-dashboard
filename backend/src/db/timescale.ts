import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createChildLogger('timescale');

// Override pg type parsers so TIMESTAMPTZ (OID 1184) and TIMESTAMP (OID 1114)
// are returned as ISO 8601 strings instead of JavaScript Date objects.
// This avoids serialization issues with Fastify response schemas.
pg.types.setTypeParser(1184, (val: string) => new Date(val).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (val: string) => new Date(val + 'Z').toISOString()); // timestamp

let pool: pg.Pool | null = null;
let migrationsReady = false;

/**
 * Returns true if the metrics table exists and migrations have been applied.
 * Use this to guard routes that query the metrics table.
 */
export function isMetricsDbReady(): boolean {
  return pool !== null && migrationsReady;
}

export async function getMetricsDb(): Promise<pg.Pool> {
  if (!pool) {
    const config = getConfig();

    const newPool = new pg.Pool({
      connectionString: config.TIMESCALE_URL,
      max: config.TIMESCALE_MAX_CONNECTIONS,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    newPool.on('error', (err) => {
      log.error({ err }, 'Unexpected TimescaleDB pool error');
    });

    log.info('TimescaleDB pool created');

    try {
      await runMigrations(newPool);
      migrationsReady = true;
    } catch (err) {
      log.error({ err }, 'TimescaleDB migrations failed — pool will be retried on next call');
      await newPool.end().catch(() => {});
      throw err;
    }

    // Only persist the pool after migrations succeed
    pool = newPool;
    await applyRetentionPolicies(pool, config);
  }
  return pool;
}

async function runMigrations(db: pg.Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _ts_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'timescale-migrations');
  if (!fs.existsSync(migrationsDir)) {
    log.info('No timescale-migrations directory found, skipping');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await db.query('SELECT name FROM _ts_migrations');
  const applied = new Set(rows.map((row: { name: string }) => row.name));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    log.info({ migration: file }, 'Applying TimescaleDB migration');

    // Split on semicolons at statement boundaries and execute each individually.
    // CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) cannot run
    // inside a transaction block, so we must avoid multi-statement queries
    // (which pg implicitly wraps in BEGIN/COMMIT).
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => {
        // Keep chunks that contain at least one non-comment, non-empty line
        return s.split('\n').some((line) => {
          const t = line.trim();
          return t.length > 0 && !t.startsWith('--');
        });
      });

    for (const stmt of statements) {
      await db.query(stmt.endsWith(';') ? stmt : stmt + ';');
    }

    await db.query('INSERT INTO _ts_migrations (name) VALUES ($1)', [file]);

    log.info({ migration: file }, 'TimescaleDB migration applied');
  }
}

async function applyRetentionPolicies(
  db: pg.Pool,
  config: ReturnType<typeof getConfig>,
): Promise<void> {
  const policies = [
    { table: 'metrics', days: config.METRICS_RAW_RETENTION_DAYS },
    { table: 'kpi_snapshots', days: config.METRICS_RAW_RETENTION_DAYS },
  ];

  for (const { table, days } of policies) {
    try {
      // Remove existing policy first (if any), then add the configured one
      await db.query(`SELECT remove_retention_policy('${table}', if_exists => true)`);
      await db.query(
        `SELECT add_retention_policy('${table}', INTERVAL '${days} days', if_not_exists => true)`,
      );
      log.info({ table, retentionDays: days }, 'Retention policy applied');
    } catch (err) {
      log.warn({ err, table }, 'Failed to apply retention policy (table may not exist yet)');
    }
  }
}

export async function closeMetricsDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    migrationsReady = false;
    log.info('TimescaleDB pool closed');
  }
}

export async function isMetricsDbHealthy(): Promise<boolean> {
  try {
    const db = await getMetricsDb();
    // Verify both connectivity AND that the metrics table exists
    const { rows } = await db.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'metrics'
      ) as ok`,
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}
