import { getDb } from '../db/sqlite.js';
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

export function insertKpiSnapshot(snapshot: Omit<KpiSnapshot, 'timestamp'>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO kpi_snapshots (endpoints, endpoints_up, endpoints_down, running, stopped, healthy, unhealthy, total, stacks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.endpoints,
    snapshot.endpoints_up,
    snapshot.endpoints_down,
    snapshot.running,
    snapshot.stopped,
    snapshot.healthy,
    snapshot.unhealthy,
    snapshot.total,
    snapshot.stacks,
  );
  log.debug('KPI snapshot inserted');
}

export function getKpiHistory(hours = 24): KpiSnapshot[] {
  const db = getDb();
  return db.prepare(`
    SELECT endpoints, endpoints_up, endpoints_down, running, stopped,
           healthy, unhealthy, total, stacks, timestamp
    FROM kpi_snapshots
    WHERE timestamp >= datetime('now', ? || ' hours')
    ORDER BY timestamp ASC
  `).all(`-${hours}`) as KpiSnapshot[];
}

export function cleanOldKpiSnapshots(retentionDays: number): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM kpi_snapshots
    WHERE timestamp < datetime('now', ? || ' days')
  `).run(`-${retentionDays}`);
  return result.changes;
}
