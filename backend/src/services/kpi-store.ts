import { getMetricsDb } from '../db/timescale.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('kpi-store');

export interface KpiSnapshot {
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

export async function insertKpiSnapshot(snapshot: Omit<KpiSnapshot, 'timestamp'>): Promise<void> {
  const db = await getMetricsDb();
  await db.query(
    `INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      snapshot.endpoints,
      snapshot.endpoints_up,
      snapshot.endpoints_down,
      snapshot.running,
      snapshot.stopped,
      snapshot.healthy,
      snapshot.unhealthy,
      snapshot.total,
      snapshot.stacks,
    ],
  );
  log.debug('KPI snapshot inserted');
}

export async function getKpiHistory(hours = 24): Promise<KpiSnapshot[]> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT endpoints, endpoints_up, endpoints_down, running, stopped,
            healthy, unhealthy, total, stacks, timestamp
     FROM kpi_snapshots
     WHERE timestamp >= NOW() - $1 * INTERVAL '1 hour'
     ORDER BY timestamp ASC`,
    [hours],
  );
  return rows as KpiSnapshot[];
}

export async function cleanOldKpiSnapshots(retentionDays: number): Promise<number> {
  const db = await getMetricsDb();
  const { rowCount } = await db.query(
    `DELETE FROM kpi_snapshots WHERE timestamp < NOW() - $1 * INTERVAL '1 day'`,
    [retentionDays],
  );
  return rowCount ?? 0;
}
