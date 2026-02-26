import { getContainerStats } from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('metrics-collector');

export interface CollectedMetrics {
  cpu: number;
  memory: number;
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
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (stats.cpu_stats.system_cpu_usage ?? 0) -
    (stats.precpu_stats.system_cpu_usage ?? 0);
  const numCpus = stats.cpu_stats.online_cpus ?? 1;

  let cpuPercent = 0;
  if (systemDelta > 0 && cpuDelta >= 0) {
    cpuPercent = (cpuDelta / systemDelta) * numCpus * 100;
  }

  // Memory % calculation: (usage - cache) / limit * 100
  const memoryUsage = stats.memory_stats.usage ?? 0;
  const memoryCache =
    stats.memory_stats.stats?.cache ??
    stats.memory_stats.stats?.total_cache ??
    0;
  const memoryLimit = stats.memory_stats.limit ?? 0;

  let memoryPercent = 0;
  const memoryBytes = memoryUsage - memoryCache;
  if (memoryLimit > 0) {
    memoryPercent = (memoryBytes / memoryLimit) * 100;
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

  // Clamp values to valid ranges
  cpuPercent = Math.max(0, Math.min(cpuPercent, 100 * numCpus));
  memoryPercent = Math.max(0, Math.min(memoryPercent, 100));

  log.debug(
    { containerId, cpuPercent, memoryPercent, memoryBytes, networkRxBytes, networkTxBytes },
    'Metrics collected',
  );

  return {
    cpu: Math.round(cpuPercent * 100) / 100,
    memory: Math.round(memoryPercent * 100) / 100,
    memoryBytes: Math.max(0, memoryBytes),
    networkRxBytes,
    networkTxBytes,
  };
}
