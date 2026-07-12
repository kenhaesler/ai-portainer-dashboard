/**
 * Primary live Docker-info source for all reachable Docker endpoints (issue #1249+).
 *
 * This module is the authoritative source for per-endpoint container counts and
 * host CPU/memory via Portainer's `/docker/info` proxy. It supersedes the
 * per-endpoint `Snapshots[]` array, which may be stale or absent (e.g. Edge
 * Agent Standard endpoints, Type=4, AsyncMode=false, where Portainer EE 2.39
 * does not write persistent snapshot entries).
 *
 * Constraints (per issue #1249):
 *
 * - **Dedicated concurrency budget.** Separate `p-limit` so that a fleet of
 *   dozens of endpoints never fans out simultaneously. Sized by
 *   `EDGE_LIVE_QUERY_CONCURRENCY` (default 2).
 * - **SWR caching.** Wrapped in `cachedFetchSWR` keyed per endpoint, so the
 *   dashboard returns stale data instantly and revalidates in the background.
 *   TTL controlled by `EDGE_LIVE_QUERY_INTERVAL_SECONDS` (default 60s).
 * - **Per-call timeout.** A slow agent must never block the dashboard.
 *   Bounded by `EDGE_LIVE_QUERY_TIMEOUT_MS` (default 5000ms).
 * - **Graceful degradation.** On failure or when disabled, returns `null` so
 *   the caller can mark the endpoint as `snapshotSource: 'unavailable'`.
 * - **Negative caching.** A failed probe is remembered for
 *   `EDGE_LIVE_NEGATIVE_TTL_SECONDS` so an endpoint that Portainer reports
 *   "up" but whose agent is unreachable fails fast on subsequent requests
 *   instead of re-paying the full timeout on every dashboard load (#1500).
 *
 * Defaults are tunable at runtime via the Settings UI (see
 * `getEffectiveEdgeLiveQueryConfig` in `services/settings-store.ts`), which
 * lets operators dial concurrency/interval down without a backend restart.
 */
import pLimit from 'p-limit';
import { fetch as undiciFetch } from 'undici';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { cache, cachedFetchSWR, getCacheKey } from './portainer-cache.js';
import { buildApiUrl, buildApiHeaders } from './portainer-client.js';

const log = createChildLogger('edge-live-query');

/** Minimal slice of Docker `/info` that we actually use. */
export interface LiveDockerInfo {
  containers: number;
  containersRunning: number;
  containersStopped: number;
  /** Optional — Docker rarely has paused containers, and the normalizer doesn't use it today. */
  containersPaused?: number;
  /** Docker NCPU — host CPU core count. */
  ncpu: number;
  /** Docker MemTotal — host memory in bytes. */
  memTotal: number;
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

/**
 * Negative-cache TTL for failed live `/docker/info` probes (#1500).
 *
 * A failed blocking fetch invalidates the positive SWR entry (invalidate-on-
 * failure in portainer-cache), so without a failure marker every subsequent
 * dashboard request re-pays the full `EDGE_LIVE_QUERY_TIMEOUT_MS` for an
 * endpoint that Portainer reports "up" but whose agent is unreachable.
 * 30 seconds matches the cache's L1 TTL cap and stays well below the 60s
 * positive-entry interval, so a recovered agent is picked up within half a
 * normal refresh cycle.
 */
export const EDGE_LIVE_NEGATIVE_TTL_SECONDS = 30;

/** Distinct key prefix so failure markers never collide with positive `edge-live-info:` entries. */
export function edgeLiveQueryNegativeCacheKey(endpointId: number): string {
  return getCacheKey('edge-live-info-failed', endpointId);
}

interface PortainerDockerInfoResponse {
  Containers?: number;
  ContainersRunning?: number;
  ContainersStopped?: number;
  ContainersPaused?: number;
  NCPU?: number;
  MemTotal?: number;
}

/**
 * Issue a single `/docker/info` call through Portainer's tunnel proxy.
 * Intentionally bypasses the main `portainerFetch` helper because we want a
 * tighter timeout, a separate concurrency budget, and no retry storm — a slow
 * or unreachable edge agent should fail fast and let the dashboard render.
 */
async function fetchDockerInfoOnce(endpointId: number, timeoutMs: number): Promise<LiveDockerInfo> {
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
      ncpu: body.NCPU ?? 0,
      memTotal: body.MemTotal ?? 0,
      fetchedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch live Docker info for an up Docker endpoint, going through the
 * dedicated concurrency limiter and SWR cache.
 *
 * Returns `null` when the live-query feature is disabled, or when the fetch
 * fails / times out. Callers should treat `null` as
 * `snapshotSource: 'unavailable'`.
 *
 * @param endpointId Portainer endpoint id
 * @param cfg Effective runtime config (env merged with Settings overrides)
 */
export async function fetchLiveDockerInfo(
  endpointId: number,
  cfg: EdgeLiveQueryConfig = getEdgeLiveQueryConfigFromEnv(),
): Promise<LiveDockerInfo | null> {
  if (!cfg.enabled) return null;

  // Negative caching is part of the cache layer — when caching is disabled
  // every call must hit the real probe, exactly like cachedFetchSWR does.
  const cacheEnabled = getConfig().CACHE_ENABLED;
  const negativeKey = edgeLiveQueryNegativeCacheKey(endpointId);

  // Fail fast on a recently-failed endpoint (#1500). The L1 lookup is
  // synchronous, so the happy path pays no extra round-trip. The marker is
  // only written after a blocking-fetch failure, which has already
  // invalidated the positive entry — so it never masks fresh data.
  if (cacheEnabled && cache.getMemoryWithStaleInfo(negativeKey)) {
    return null;
  }

  const limit = getLimiter(cfg.concurrency);

  try {
    return await cachedFetchSWR<LiveDockerInfo>(
      edgeLiveQueryCacheKey(endpointId),
      cfg.intervalSeconds,
      () => limit(() => fetchDockerInfoOnce(endpointId, cfg.timeoutMs)),
    );
  } catch (err) {
    log.warn({ endpointId, err }, 'Live Docker-info fetch failed');
    if (cacheEnabled) {
      // Best-effort failure marker so the next EDGE_LIVE_NEGATIVE_TTL_SECONDS
      // of requests skip the timeout for this endpoint instead of blocking.
      try {
        await cache.set(negativeKey, Date.now(), EDGE_LIVE_NEGATIVE_TTL_SECONDS);
      } catch {
        // Never let marker storage mask the graceful-degradation path.
      }
    }
    return null;
  }
}
