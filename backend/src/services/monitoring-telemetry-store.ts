import { getDbForDomain } from '../core/db/app-db-router.js';

const db = getDbForDomain('monitoring');

export async function insertMonitoringCycle(durationMs: number): Promise<void> {
  await db.execute(
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
  await db.execute(
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
