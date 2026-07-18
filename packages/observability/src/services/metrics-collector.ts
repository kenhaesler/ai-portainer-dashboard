import { getContainerStats } from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('metrics-collector');

export interface CollectedMetrics {
  /**
   * CPU utilization percent (Docker `docker stats` convention: 100% = one
   * core). `null` when it could not be reliably computed this cycle — e.g.
   * `system_cpu_usage` is missing from either the current or previous stats
   * snapshot, so no valid `systemDelta` exists. Callers MUST treat `null` as
   * "unknown, exclude from aggregates" — never coerce it to `0` (#1567: a
   * container whose CPU is unknown was previously reported as idle, dragging
   * fleet-wide averages down).
   */
  cpu: number | null;
  /**
   * Memory utilization percent (`used / limit * 100`). `null` when
   * `memory_stats.usage` is missing, or `memory_stats.limit` is missing or
   * non-positive, so no meaningful percentage can be computed. Same
   * "exclude, don't zero-fill" contract as `cpu` (#1567).
   */
  memory: number | null;
  memoryBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export async function collectMetrics(
  endpointId: number,
  containerId: string,
): Promise<CollectedMetrics> {
  const stats = await cachedFetch(
    getCacheKey('stats', endpointId, containerId),
    TTL.STATS,
    () => getContainerStats(endpointId, containerId),
  );

  // CPU % calculation: (cpu_delta / system_delta) * num_cpus * 100
  //
  // #1567: `system_cpu_usage` is optional in the Docker stats payload — when
  // it is absent from either snapshot there is no way to compute a valid
  // systemDelta, so CPU% is unknowable this cycle. The previous implementation
  // defaulted the missing field to 0 via `?? 0`, which silently produced
  // `systemDelta = 0` and therefore a reported `cpuPercent` of `0` —
  // indistinguishable from a genuinely idle container. We now check presence
  // explicitly and report `null` ("unknown") instead, so persistence/
  // aggregation can exclude the sample rather than average in a fake 0%.
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const numCpus = stats.cpu_stats.online_cpus ?? 1;

  let cpuPercent: number | null = null;
  if (
    stats.cpu_stats.system_cpu_usage != null &&
    stats.precpu_stats.system_cpu_usage != null
  ) {
    const systemDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    if (systemDelta > 0 && cpuDelta >= 0) {
      cpuPercent = Math.max(0, Math.min((cpuDelta / systemDelta) * numCpus * 100, 100 * numCpus));
    }
  }

  // Memory % calculation: (usage - cache) / limit * 100
  //
  // #1567: `memory_stats.limit` is optional. A missing or non-positive limit
  // means the percentage has no valid denominator — previously defaulted to
  // 0 (via `?? 0`), producing a misleading 0% instead of "unknown". We do NOT
  // fall back to total node memory as the divisor here (see PR description):
  // Docker itself already reports the host's total memory as `limit` when a
  // container has no explicit `--memory` cap, so a limit that is still
  // missing/non-positive by the time it reaches this code signals a
  // malformed or incomplete stats payload, not a "no limit configured"
  // container. Guessing a divisor for data we already know is untrustworthy
  // would trade one silent wrong number for another; `null` is honest.
  const memoryUsage = stats.memory_stats.usage;
  const memoryCache =
    stats.memory_stats.stats?.cache ??
    stats.memory_stats.stats?.total_cache ??
    0;
  // Keep the existing numeric byte contract for downstream counters, but do
  // not let its fallback participate in the percentage calculation when the
  // source usage value itself is absent.
  const memoryBytes = memoryUsage == null ? 0 : Math.max(0, memoryUsage - memoryCache);

  let memoryPercent: number | null = null;
  const memoryLimit = stats.memory_stats.limit;
  if (memoryUsage != null && memoryLimit != null && memoryLimit > 0) {
    memoryPercent = Math.max(0, Math.min((memoryBytes / memoryLimit) * 100, 100));
  }

  // Network I/O: sum all interfaces
  let networkRxBytes = 0;
  let networkTxBytes = 0;
  if (stats.networks) {
    for (const iface of Object.values(stats.networks)) {
      networkRxBytes += iface.rx_bytes ?? 0;
      networkTxBytes += iface.tx_bytes ?? 0;
    }
  }

  log.debug(
    { containerId, cpuPercent, memoryPercent, memoryBytes, networkRxBytes, networkTxBytes },
    'Metrics collected',
  );

  return {
    cpu: cpuPercent === null ? null : Math.round(cpuPercent * 100) / 100,
    memory: memoryPercent === null ? null : Math.round(memoryPercent * 100) / 100,
    memoryBytes,
    networkRxBytes,
    networkTxBytes,
  };
}
