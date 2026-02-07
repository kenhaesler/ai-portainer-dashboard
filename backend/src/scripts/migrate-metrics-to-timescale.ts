/**
 * One-time migration script: copies historical metrics and KPI snapshots
 * from SQLite to TimescaleDB.
 *
 * Usage:
 *   npx tsx src/scripts/migrate-metrics-to-timescale.ts [--dry-run]
 *
 * Env vars: TIMESCALE_URL, SQLITE_PATH (reads from .env if present)
 */

import { getDb } from '../db/sqlite.js';
import { getMetricsDb, closeMetricsDb } from '../db/timescale.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('migrate-metrics');

const BATCH_SIZE = 5000;

interface SqliteMetric {
  endpoint_id: number;
  container_id: string;
  container_name: string;
  metric_type: string;
  value: number;
  timestamp: string;
}

interface SqliteKpi {
  endpoints: number;
  endpoints_up: number;
  endpoints_down: number;
  running: number;
  stopped: number;
  healthy: number;
  unhealthy: number;
  total: number;
  stacks: number;
  timestamp: string;
}

async function migrateMetrics(dryRun: boolean): Promise<number> {
  const db = getDb();
  const pool = await getMetricsDb();

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM metrics').get() as { cnt: number };
  const totalRows = countRow.cnt;
  log.info({ totalRows, dryRun }, 'Starting metrics migration');

  if (totalRows === 0) {
    log.info('No metrics to migrate');
    return 0;
  }

  let migrated = 0;
  let offset = 0;

  while (offset < totalRows) {
    const rows = db.prepare(
      'SELECT endpoint_id, container_id, container_name, metric_type, value, timestamp FROM metrics ORDER BY timestamp ASC LIMIT ? OFFSET ?',
    ).all(BATCH_SIZE, offset) as SqliteMetric[];

    if (rows.length === 0) break;

    if (!dryRun) {
      const endpointIds: number[] = [];
      const containerIds: string[] = [];
      const containerNames: string[] = [];
      const metricTypes: string[] = [];
      const values: number[] = [];
      const timestamps: string[] = [];

      for (const row of rows) {
        endpointIds.push(row.endpoint_id);
        containerIds.push(row.container_id);
        containerNames.push(row.container_name);
        metricTypes.push(row.metric_type);
        values.push(row.value);
        timestamps.push(row.timestamp);
      }

      await pool.query(
        `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
         SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::double precision[], $6::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [endpointIds, containerIds, containerNames, metricTypes, values, timestamps],
      );
    }

    migrated += rows.length;
    offset += BATCH_SIZE;

    if (migrated % 50000 === 0 || migrated === totalRows) {
      log.info({ migrated, totalRows, progress: `${((migrated / totalRows) * 100).toFixed(1)}%` }, 'Migration progress');
    }
  }

  return migrated;
}

async function migrateKpiSnapshots(dryRun: boolean): Promise<number> {
  const db = getDb();
  const pool = await getMetricsDb();

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM kpi_snapshots').get() as { cnt: number };
  const totalRows = countRow.cnt;
  log.info({ totalRows, dryRun }, 'Starting KPI snapshots migration');

  if (totalRows === 0) {
    log.info('No KPI snapshots to migrate');
    return 0;
  }

  let migrated = 0;
  let offset = 0;

  while (offset < totalRows) {
    const rows = db.prepare(
      'SELECT endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp FROM kpi_snapshots ORDER BY timestamp ASC LIMIT ? OFFSET ?',
    ).all(BATCH_SIZE, offset) as SqliteKpi[];

    if (rows.length === 0) break;

    if (!dryRun) {
      const endpoints: number[] = [];
      const endpointsUp: number[] = [];
      const endpointsDown: number[] = [];
      const running: number[] = [];
      const stopped: number[] = [];
      const healthy: number[] = [];
      const unhealthy: number[] = [];
      const total: number[] = [];
      const stacks: number[] = [];
      const timestamps: string[] = [];

      for (const row of rows) {
        endpoints.push(row.endpoints);
        endpointsUp.push(row.endpoints_up);
        endpointsDown.push(row.endpoints_down);
        running.push(row.running);
        stopped.push(row.stopped);
        healthy.push(row.healthy);
        unhealthy.push(row.unhealthy);
        total.push(row.total);
        stacks.push(row.stacks);
        timestamps.push(row.timestamp);
      }

      await pool.query(
        `INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks, timestamp)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[], $10::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [endpoints, endpointsUp, endpointsDown, running, stopped, healthy, unhealthy, total, stacks, timestamps],
      );
    }

    migrated += rows.length;
    offset += BATCH_SIZE;
  }

  return migrated;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    log.info('DRY RUN mode — no data will be written to TimescaleDB');
  }

  try {
    const metricsMigrated = await migrateMetrics(dryRun);
    const kpiMigrated = await migrateKpiSnapshots(dryRun);

    log.info(
      { metricsMigrated, kpiMigrated, dryRun },
      'Migration complete',
    );
  } catch (err) {
    log.error({ err }, 'Migration failed');
    process.exit(1);
  } finally {
    await closeMetricsDb();
  }
}

main();
