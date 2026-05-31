import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { isUndefinedTableError } from './metrics-store.js';

/**
 * Returns the set of currently-running container ids for the given endpoint
 * (or all endpoints when omitted). Returns `null` to signal "fail open" — the
 * lifecycle table has no rows for this scope (fresh deploy / not yet populated)
 * or does not exist — so callers should NOT filter. An empty Set means the
 * scope is known but nothing is running.
 */
export async function getRunningContainerIds(endpointId?: number): Promise<Set<string> | null> {
  const db = await getMetricsDb();
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
