import { getDb } from '../db/sqlite.js';

export function insertMonitoringCycle(durationMs: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO monitoring_cycles (duration_ms, created_at)
     VALUES (?, datetime('now'))`,
  ).run(durationMs);
}

export function insertMonitoringSnapshot(data: {
  containersRunning: number;
  containersStopped: number;
  containersUnhealthy: number;
  endpointsUp: number;
  endpointsDown: number;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO monitoring_snapshots (
      containers_running,
      containers_stopped,
      containers_unhealthy,
      endpoints_up,
      endpoints_down,
      created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    data.containersRunning,
    data.containersStopped,
    data.containersUnhealthy,
    data.endpointsUp,
    data.endpointsDown,
  );
}
