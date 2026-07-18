/**
 * Live fleet data — the single source of truth for endpoint container counts,
 * host CPU/memory, container health, and stack totals. Replaces all reads of
 * Portainer's per-endpoint Snapshots[] (which edge agents stopped writing back).
 *
 * Lives in core so every layer — foundation routes, the scheduler, and
 * ai-intelligence (which may not import foundation) — can share it.
 */
import pLimit from 'p-limit';
import { getEndpoints, getContainers, getStacks } from './portainer-client.js';
import { cachedFetchSWR, getCacheKey, getSnapshotTimestamp, TTL } from './portainer-cache.js';
import {
  normalizeEndpointAsOf, normalizeContainer, applyLiveDockerInfo, markLiveUnavailable,
  endpointSupportsLiveDockerInfo, type NormalizedEndpoint, type NormalizedContainer,
} from './portainer-normalizers.js';
import { fetchLiveDockerInfo } from './edge-live-query.js';
import { getEffectiveEdgeLiveQueryConfig, type EdgeLiveQueryConfig } from '../services/settings-store.js';
import { isDockerEndpoint, type Stack } from '../models/portainer.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('live-fleet');

// Shared cap for the per-request container fan-out — keeps a single fleet-overview
// call from saturating the global portainer-client pool. Mirrors dashboard.ts.
const containerFanoutLimit = pLimit(5);

export interface FleetTotals {
  endpoints: number; endpointsUp: number; endpointsDown: number;
  running: number; stopped: number; total: number;
  healthy: number; unhealthy: number; stacks: number;
}

/** Overlay live `/docker/info` onto every up Docker endpoint; everything else stays unavailable. */
export async function enrichEndpointsWithLiveDockerInfo(
  normalized: NormalizedEndpoint[],
  cfg?: EdgeLiveQueryConfig,
): Promise<NormalizedEndpoint[]> {
  let config = cfg;
  if (!config) {
    try { config = await getEffectiveEdgeLiveQueryConfig(); }
    catch (err) { log.warn({ err }, 'live-query config unavailable — leaving endpoints unavailable'); return normalized; }
  }
  if (!config.enabled) return normalized; // kill-switch: no snapshot fallback → stay unavailable

  const targets = normalized.filter(endpointSupportsLiveDockerInfo);
  const results = await Promise.allSettled(targets.map((ep) => fetchLiveDockerInfo(ep.id, config)));
  for (let i = 0; i < targets.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) applyLiveDockerInfo(targets[i], r.value);
    else markLiveUnavailable(targets[i]);
  }
  return normalized;
}

/** Fill per-endpoint stackCount from Portainer's stacks list (live, grouped by EndpointId). */
export function attachStackCounts(normalized: NormalizedEndpoint[], stacks: Stack[]): NormalizedEndpoint[] {
  const counts = new Map<number, number>();
  for (const s of stacks) counts.set(s.EndpointId, (counts.get(s.EndpointId) ?? 0) + 1);
  for (const ep of normalized) ep.stackCount = counts.get(ep.id) ?? 0;
  return normalized;
}

/**
 * Fleet KPIs: counts from enriched endpoints, health from live containers, stacks from the stacks list.
 * @param stackTotal Fleet-wide stack count (pass stacks.length).
 */
export function computeFleetTotals(
  endpoints: NormalizedEndpoint[], containers: NormalizedContainer[], stackTotal: number,
): FleetTotals {
  let running = 0, stopped = 0, total = 0, up = 0, down = 0;
  for (const ep of endpoints) {
    running += ep.containersRunning; stopped += ep.containersStopped; total += ep.totalContainers;
    if (ep.status === 'up') up++; else down++;
  }
  let healthy = 0, unhealthy = 0;
  for (const c of containers) {
    if (c.healthStatus === 'healthy') healthy++;
    else if (c.healthStatus === 'unhealthy') unhealthy++;
  }
  return { endpoints: endpoints.length, endpointsUp: up, endpointsDown: down, running, stopped, total, healthy, unhealthy, stacks: stackTotal };
}

export interface FleetOverview {
  endpoints: NormalizedEndpoint[];
  containers: NormalizedContainer[];
  stacks: Stack[];
  totals: FleetTotals;
}

/**
 * Full pipeline for consumers that don't already hold container lists
 * (endpoints route, scheduler KPI writer, LLM context). Endpoints, stacks, and
 * containers are SWR-cached and shared with the rest of the app.
 */
export async function collectFleetOverview(cfg?: EdgeLiveQueryConfig): Promise<FleetOverview> {
  const endpointsCacheKey = getCacheKey('endpoints');
  const raw = (await cachedFetchSWR(endpointsCacheKey, TTL.ENDPOINTS, () => getEndpoints())) ?? [];
  // Evaluate Edge heartbeat status against when this snapshot was actually
  // fetched from Portainer, not against "now" — `raw` can be served stale-
  // while-revalidate out of a 15-minute cache, and judging a cached-but-
  // healthy endpoint against the current wall clock flips it to "down" as the
  // cache ages (issue #1566, "All Hosts Down" flapping).
  const referenceTimeMs = getSnapshotTimestamp(endpointsCacheKey) ?? Date.now();
  const endpoints = raw.map((ep) => normalizeEndpointAsOf(ep, { referenceTimeMs }));

  // Live enrichment mutates only counts/totalCpu/totalMemory/snapshotSource —
  // never the status/type fields the up/Docker filter reads — so it runs
  // concurrently with the stacks fetch and the container fan-out instead of
  // serializing ahead of them (#1500).
  const enrichPromise = enrichEndpointsWithLiveDockerInfo(endpoints, cfg);
  const stacksPromise: Promise<Stack[]> = cachedFetchSWR(getCacheKey('stacks'), TTL.STACKS, () => getStacks())
    .then((s) => s ?? [])
    .catch((err) => { log.warn({ err }, 'stacks fetch failed — stack counts default to 0'); return []; });

  const upDocker = endpoints.filter((ep) => ep.status === 'up' && isDockerEndpoint(ep.type));
  const settledPromise = Promise.allSettled(upDocker.map((ep) =>
    containerFanoutLimit(() => cachedFetchSWR(getCacheKey('containers', ep.id), TTL.CONTAINERS, () => getContainers(ep.id)).then((cs) => ({ ep, cs }))),
  ));

  const [, stacks, settled] = await Promise.all([enrichPromise, stacksPromise, settledPromise]);
  attachStackCounts(endpoints, stacks);

  const containers: NormalizedContainer[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      const { ep, cs } = r.value;
      for (const c of cs) containers.push(normalizeContainer(c, ep.id, ep.name));
    } else {
      log.warn({ err: r.reason }, 'container fetch failed for an endpoint during fleet overview');
    }
  }
  return { endpoints, containers, stacks, totals: computeFleetTotals(endpoints, containers, stacks.length) };
}
