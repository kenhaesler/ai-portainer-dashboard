import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { runMonitoringCycle } from '../services/monitoring-service.js';
import { collectMetrics } from '../services/metrics-collector.js';
import { insertMetrics, cleanOldMetrics, type MetricInsert } from '../services/metrics-store.js';
import { getEndpoints, getContainers } from '../services/portainer-client.js';
import { cleanupOldCaptures } from '../services/pcap-service.js';

const log = createChildLogger('scheduler');

const intervals: NodeJS.Timeout[] = [];

async function runMetricsCollection(): Promise<void> {
  log.debug('Running metrics collection cycle');

  try {
    const endpoints = await getEndpoints();
    const metricsToInsert: MetricInsert[] = [];

    for (const ep of endpoints) {
      try {
        const containers = await getContainers(ep.Id);
        const running = containers.filter((c) => c.State === 'running');

        for (const container of running) {
          try {
            const stats = await collectMetrics(ep.Id, container.Id);
            const containerName =
              container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);

            metricsToInsert.push(
              {
                endpoint_id: ep.Id,
                container_id: container.Id,
                container_name: containerName,
                metric_type: 'cpu',
                value: stats.cpu,
              },
              {
                endpoint_id: ep.Id,
                container_id: container.Id,
                container_name: containerName,
                metric_type: 'memory',
                value: stats.memory,
              },
              {
                endpoint_id: ep.Id,
                container_id: container.Id,
                container_name: containerName,
                metric_type: 'memory_bytes',
                value: stats.memoryBytes,
              },
            );
          } catch (err) {
            log.warn(
              { containerId: container.Id, err },
              'Failed to collect metrics for container',
            );
          }
        }
      } catch (err) {
        log.warn({ endpointId: ep.Id, err }, 'Failed to fetch containers for endpoint');
      }
    }

    if (metricsToInsert.length > 0) {
      insertMetrics(metricsToInsert);
    }

    log.debug({ metricsCount: metricsToInsert.length }, 'Metrics collection cycle completed');
  } catch (err) {
    log.error({ err }, 'Metrics collection cycle failed');
  }
}

async function runMonitoringWithErrorHandling(): Promise<void> {
  try {
    await runMonitoringCycle();
  } catch (err) {
    log.error({ err }, 'Monitoring cycle failed');
  }
}

async function runCleanup(): Promise<void> {
  try {
    const config = getConfig();
    const deleted = cleanOldMetrics(config.METRICS_RETENTION_DAYS);
    if (deleted > 0) {
      log.info({ deleted }, 'Old metrics cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Metrics cleanup failed');
  }

  try {
    cleanupOldCaptures();
  } catch (err) {
    log.error({ err }, 'PCAP captures cleanup failed');
  }
}

export function startScheduler(): void {
  const config = getConfig();

  if (config.METRICS_COLLECTION_ENABLED) {
    const metricsIntervalMs = config.METRICS_COLLECTION_INTERVAL_SECONDS * 1000;
    log.info(
      { intervalSeconds: config.METRICS_COLLECTION_INTERVAL_SECONDS },
      'Starting metrics collection scheduler',
    );
    const metricsInterval = setInterval(runMetricsCollection, metricsIntervalMs);
    intervals.push(metricsInterval);
  }

  if (config.MONITORING_ENABLED) {
    const monitoringIntervalMs = config.MONITORING_INTERVAL_MINUTES * 60 * 1000;
    log.info(
      { intervalMinutes: config.MONITORING_INTERVAL_MINUTES },
      'Starting monitoring scheduler',
    );
    const monitoringInterval = setInterval(runMonitoringWithErrorHandling, monitoringIntervalMs);
    intervals.push(monitoringInterval);
  }

  // Cleanup old metrics once per day
  const cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1000);
  intervals.push(cleanupInterval);

  log.info({ taskCount: intervals.length }, 'Scheduler started');
}

export function stopScheduler(): void {
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals.length = 0;
  log.info('Scheduler stopped');
}
