/**
 * Edge Standard live Docker-info fallback (issue #1249).
 *
 * Portainer EE 2.39 does not write persistent `Snapshots[]` entries for Edge
 * Agent Standard endpoints (Type=4, AsyncMode=false). As a result, the
 * normalizer reports 0/0/0 container counts for those endpoints even when the
 * agent is fully connected and reachable via the chisel tunnel.
 *
 * This module fills that gap: when an Edge Standard endpoint has empty
 * `Snapshots[]`, the route layer can call `fetchEdgeLiveDockerInfo(id)` to
 * pull a live `/docker/info` summary through Portainer's tunnel proxy.
 *
 * Constraints (per issue #1249):
 *
 * - **Dedicated concurrency budget.** Separate `p-limit` so that a fleet of
 *   dozens of edge nodes never fans out simultaneously and stampedes the
 *   chisel tunnel. Sized by `EDGE_LIVE_QUERY_CONCURRENCY` (default 2).
 * - **SWR caching.** Wrapped in `cachedFetchSWR` keyed per endpoint, so the
 *   dashboard returns stale data instantly and revalidates in the background.
 *   TTL controlled by `EDGE_LIVE_QUERY_INTERVAL_SECONDS` (default 60s).
 * - **Per-call timeout.** A slow agent must never block the dashboard.
 *   Bounded by `EDGE_LIVE_QUERY_TIMEOUT_MS` (default 5000ms).
 * - **Graceful degradation.** On failure or when disabled, returns `null` so
 *   the caller can mark the endpoint as `snapshotSource: 'unavailable'`.
 *
 * Defaults are tunable at runtime via the Settings UI (see
 * `getEffectiveEdgeLiveQueryConfig` in `services/settings-store.ts`), which
 * lets operators dial concurrency/interval down without a backend restart.
 */
import pLimit from 'p-limit';
import { fetch as undiciFetch } from 'undici';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { cachedFetchSWR, getCacheKey } from './portainer-cache.js';
import { buildApiUrl, buildApiHeaders } from './portainer-client.js';

const log = createChildLogger('edge-live-query');

/** Minimal slice of Docker `/info` that we actually use. */
export interface EdgeDockerInfo {
  containers: number;
  containersRunning: number;
  containersStopped: number;
  /** Optional — Docker rarely has paused containers, and the normalizer doesn't use it today. */
  containersPaused?: number;
  fetchedAt: number;
}

/** Effective runtime config. Mirrors env vars but is intended to be overridden by Settings UI. */
export interface EdgeLiveQueryConfig {
  enabled: boolean;
  concurrency: number;
  intervalSeconds: number;
  timeoutMs: number;
}

let limiter: ReturnType<typeof pLimit> | undefined;
let limiterConcurrency: number | undefined;

/**
 * Get the live-query limiter, rebuilding when the concurrency value changes.
 * This allows the Settings UI to adjust concurrency at runtime without a restart.
 */
function getLimiter(concurrency: number): ReturnType<typeof pLimit> {
  if (!limiter || limiterConcurrency !== concurrency) {
    limiter = pLimit(concurrency);
    limiterConcurrency = concurrency;
  }
  return limiter;
}

/** Reset cached limiter state — for tests. */
export function _resetEdgeLiveQueryState(): void {
  limiter = undefined;
  limiterConcurrency = undefined;
}

/**
 * Build a runtime config from env. The settings-store may later override this
 * before each request. Kept here so callers without a DB still get sensible
 * behavior (e.g. unit tests, CLI scripts).
 */
export function getEdgeLiveQueryConfigFromEnv(): EdgeLiveQueryConfig {
  const cfg = getConfig();
  return {
    enabled: cfg.EDGE_LIVE_QUERY_ENABLED,
    concurrency: cfg.EDGE_LIVE_QUERY_CONCURRENCY,
    intervalSeconds: cfg.EDGE_LIVE_QUERY_INTERVAL_SECONDS,
    timeoutMs: cfg.EDGE_LIVE_QUERY_TIMEOUT_MS,
  };
}

/** Cache key used both internally and exposed for invalidation in tests/diagnostics. */
export function edgeLiveQueryCacheKey(endpointId: number): string {
  return getCacheKey('edge-live-info', endpointId);
}

interface PortainerDockerInfoResponse {
  Containers?: number;
  ContainersRunning?: number;
  ContainersStopped?: number;
  ContainersPaused?: number;
}

/**
 * Issue a single `/docker/info` call through Portainer's tunnel proxy.
 * Intentionally bypasses the main `portainerFetch` helper because we want a
 * tighter timeout, a separate concurrency budget, and no retry storm — a slow
 * or unreachable edge agent should fail fast and let the dashboard render.
 */
async function fetchDockerInfoOnce(endpointId: number, timeoutMs: number): Promise<EdgeDockerInfo> {
  const url = buildApiUrl(`/api/endpoints/${endpointId}/docker/info`);
  const headers = buildApiHeaders(false);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as PortainerDockerInfoResponse;
    const running = body.ContainersRunning ?? 0;
    const stopped = body.ContainersStopped ?? 0;
    const paused = body.ContainersPaused ?? 0;
    // Docker's `Containers` is the canonical total (running + stopped + paused);
    // fall back to a sum if the field is missing.
    const total = body.Containers ?? running + stopped + paused;
    return {
      containers: total,
      containersRunning: running,
      containersStopped: stopped,
      containersPaused: paused,
      fetchedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch live Docker info for an Edge Standard endpoint, going through the
 * dedicated concurrency limiter and SWR cache.
 *
 * Returns `null` when the live-query feature is disabled, or when the fetch
 * fails / times out. Callers should treat `null` as
 * `snapshotSource: 'unavailable'`.
 *
 * @param endpointId Portainer endpoint id
 * @param cfg Effective runtime config (env merged with Settings overrides)
 */
export async function fetchEdgeLiveDockerInfo(
  endpointId: number,
  cfg: EdgeLiveQueryConfig = getEdgeLiveQueryConfigFromEnv(),
): Promise<EdgeDockerInfo | null> {
  if (!cfg.enabled) return null;

  const limit = getLimiter(cfg.concurrency);

  try {
    return await cachedFetchSWR<EdgeDockerInfo>(
      edgeLiveQueryCacheKey(endpointId),
      cfg.intervalSeconds,
      () => limit(() => fetchDockerInfoOnce(endpointId, cfg.timeoutMs)),
    );
  } catch (err) {
    log.warn({ endpointId, err }, 'Edge live Docker-info fetch failed');
    return null;
  }
}
