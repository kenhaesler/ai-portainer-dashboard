import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { batchedDeleteOlderThan } from '@dashboard/core/db/retention.js';

// Resolved lazily (not at module load) so test files can swap the
// app-db-router mock between imports — same pattern as audit-logger.
function db() {
  return getDbForDomain('monitoring');
}

export async function insertMonitoringCycle(durationMs: number): Promise<void> {
  await db().execute(
    `INSERT INTO monitoring_cycles (duration_ms, created_at)
     VALUES (?, NOW())`,
    [durationMs],
  );
}

export async function insertMonitoringSnapshot(data: {
  containersRunning: number;
  containersStopped: number;
  containersUnhealthy: number;
  endpointsUp: number;
  endpointsDown: number;
}): Promise<void> {
  await db().execute(
    `INSERT INTO monitoring_snapshots (
      containers_running,
      containers_stopped,
      containers_unhealthy,
      endpoints_up,
      endpoints_down,
      created_at
    ) VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      data.containersRunning,
      data.containersStopped,
      data.containersUnhealthy,
      data.endpointsUp,
      data.endpointsDown,
    ],
  );
}

/**
 * Daily retention sweep (#1505). monitoring_cycles gains ~288 rows/day at
 * the default 5-minute cadence and only feeds the Prometheus exporter's
 * cycle-duration histogram (bounded to a 24h window) — 14 days is plenty.
 */
export async function cleanOldMonitoringCycles(days: number): Promise<number> {
  return batchedDeleteOlderThan(db(), 'monitoring_cycles', 'created_at', days);
}

/**
 * Daily retention sweep (#1505). monitoring_snapshots feeds the public
 * status page's uptime windows — the widest is the 90-day daily-bucket
 * timeline, so the retention window must stay >= 90 days (enforced by the
 * MONITORING_SNAPSHOTS_RETENTION_DAYS default; lowering it truncates the
 * visible timeline but nothing breaks).
 */
export async function cleanOldMonitoringSnapshots(days: number): Promise<number> {
  return batchedDeleteOlderThan(db(), 'monitoring_snapshots', 'created_at', days);
}
