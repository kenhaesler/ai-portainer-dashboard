import { getMetricsDb, getReportsDb } from '@dashboard/core/db/timescale.js';
import { isUndefinedTableError } from './metrics-store.js';

/** Minimal container shape needed for lifecycle tracking (subset of Portainer's Container). */
export interface LifecycleContainer {
  Id: string;
  Names?: string[];
  State?: string;
}

/**
 * Record the full current container list (all states) for an endpoint so fleet
 * aggregates can exclude stopped/removed containers (#1394). Upserts every
 * present container (refreshing name/last_seen/running) then marks any
 * previously-known container that is no longer present as not running — which
 * covers both stopped and deleted containers. Call only with a successfully
 * fetched full list, so a failed fetch never mass-marks containers as gone.
 */
export async function upsertContainerLifecycle(
  endpointId: number,
  containers: LifecycleContainer[],
): Promise<void> {
  if (containers.length === 0) return;
  const db = await getMetricsDb();

  const ids: string[] = [];
  const names: string[] = [];
  const running: boolean[] = [];
  for (const c of containers) {
    ids.push(c.Id);
    names.push(c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12));
    running.push(c.State === 'running');
  }

  await db.query(
    `INSERT INTO container_lifecycle (endpoint_id, container_id, container_name, last_seen, running)
     SELECT $1::int, cid, cname, NOW(), crun
     FROM unnest($2::text[], $3::text[], $4::bool[]) AS t(cid, cname, crun)
     ON CONFLICT (endpoint_id, container_id) DO UPDATE
       SET container_name = EXCLUDED.container_name,
           last_seen      = EXCLUDED.last_seen,
           running        = EXCLUDED.running`,
    [endpointId, ids, names, running],
  );

  await db.query(
    `UPDATE container_lifecycle
        SET running = FALSE
      WHERE endpoint_id = $1 AND container_id <> ALL($2::text[])`,
    [endpointId, ids],
  );
}

/**
 * Returns the set of currently-running container ids for the given endpoint
 * (or all endpoints when omitted). Returns `null` to signal "fail open" — the
 * lifecycle table has no rows for this scope (fresh deploy / not yet populated)
 * or does not exist — so callers should NOT filter. An empty Set means the
 * scope is known but nothing is running.
 *
 * Runs on the isolated reports pool (`getReportsDb`) — the same pool the rest of
 * the reports read path uses — so this read inherits the reports pool's 10 s
 * `statement_timeout` and preserves read/write pool isolation from the metrics
 * write pool (#1394). The write path (`upsertContainerLifecycle`) stays on the
 * metrics write pool.
 */
export async function getRunningContainerIds(endpointId?: number): Promise<Set<string> | null> {
  const db = await getReportsDb();
  try {
    const { rows } = endpointId
      ? await db.query(
          'SELECT container_id, running FROM container_lifecycle WHERE endpoint_id = $1',
          [endpointId],
        )
      : await db.query('SELECT container_id, running FROM container_lifecycle');
    if (rows.length === 0) return null; // no data for scope → fail open
    return new Set(
      (rows as Array<{ container_id: string; running: boolean }>)
        .filter((r) => r.running)
        .map((r) => r.container_id),
    );
  } catch (err) {
    if (isUndefinedTableError(err)) return null; // table not created yet → fail open
    throw err;
  }
}
