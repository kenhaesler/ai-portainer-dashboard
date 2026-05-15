/**
 * Enrich Edge Standard endpoints with live `/docker/info` counts (issue #1249).
 *
 * Portainer EE doesn't write persistent Snapshots[] for Edge Agent Standard
 * endpoints, so the normalizer reports 0/0/0 container counts. This helper
 * runs after `endpoints.map(normalizeEndpoint)` and, for each endpoint that
 * matches `endpointNeedsLiveFallback`, fetches a live Docker info summary
 * through the chisel tunnel and merges the counts in.
 *
 * All concurrency, caching, and timeout behavior is owned by
 * `fetchEdgeLiveDockerInfo` — this layer is just the route-side glue.
 *
 * Errors from individual endpoints are swallowed (logged once, marked
 * `snapshotSource: 'unavailable'`) so one bad agent never breaks the
 * dashboard for the rest of the fleet.
 */
import { fetchEdgeLiveDockerInfo } from '@dashboard/core/portainer/edge-live-query.js';
import {
  applyLiveDockerInfo,
  endpointNeedsLiveFallback,
  markLiveUnavailable,
  type NormalizedEndpoint,
} from '@dashboard/core/portainer/portainer-normalizers.js';
import { getEffectiveEdgeLiveQueryConfig } from '@dashboard/core/services/settings-store.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('edge-live-enrichment');

/**
 * Walk a list of already-normalized endpoints and fill in live counts for
 * any Edge Standard endpoint whose snapshot is empty. Mutates the input
 * array in place (the caller owns it) and returns the same reference so
 * callers can chain.
 *
 * Safe to call on every dashboard request — the underlying fetcher is
 * SWR-cached so the cost amortizes to one HTTP call per endpoint per
 * `EDGE_LIVE_QUERY_INTERVAL_SECONDS` window.
 */
export async function enrichEdgeStandardWithLiveInfo(
  normalized: NormalizedEndpoint[],
): Promise<NormalizedEndpoint[]> {
  // Defensive: if the settings DB is unavailable (e.g. early boot, isolated
  // unit tests, broken migration), don't crash the route — just skip
  // enrichment. The route still returns Portainer's snapshot data, which is
  // the same behavior as before this feature existed.
  let cfg;
  try {
    cfg = await getEffectiveEdgeLiveQueryConfig();
  } catch (err) {
    log.warn({ err }, 'Edge live-query config unavailable — skipping enrichment');
    return normalized;
  }
  if (!cfg.enabled) return normalized;

  const targets = normalized.filter(endpointNeedsLiveFallback);
  if (targets.length === 0) return normalized;

  // Fan out via Promise.allSettled — fetchEdgeLiveDockerInfo already
  // enforces its own dedicated p-limit, so we don't double-cap here.
  // allSettled guarantees one slow/failed agent never poisons the others.
  const results = await Promise.allSettled(
    targets.map((ep) => fetchEdgeLiveDockerInfo(ep.id, cfg)),
  );

  for (let i = 0; i < targets.length; i++) {
    const ep = targets[i];
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      applyLiveDockerInfo(ep, r.value);
    } else {
      if (r.status === 'rejected') {
        // fetchEdgeLiveDockerInfo already logs on failure, but allSettled
        // rejection here would indicate something escaped its catch — log
        // at debug so we have a breadcrumb without being noisy.
        log.debug({ endpointId: ep.id, err: r.reason }, 'Edge live enrichment rejected');
      }
      markLiveUnavailable(ep);
    }
  }

  return normalized;
}
