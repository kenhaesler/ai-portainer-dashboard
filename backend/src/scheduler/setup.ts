import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { runMonitoringCycle } from '../services/monitoring-service.js';
import { collectMetrics } from '../services/metrics-collector.js';
import { insertMetrics, cleanOldMetrics, type MetricInsert } from '../services/metrics-store.js';
import { getEndpoints, getContainers } from '../services/portainer-client.js';
import { cleanupOldCaptures } from '../services/pcap-service.js';
import { startWebhookListener, stopWebhookListener, processRetries } from '../services/webhook-service.js';
import { insertKpiSnapshot, cleanOldKpiSnapshots } from '../services/kpi-store.js';
import { normalizeEndpoint } from '../services/portainer-normalizers.js';

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

async function runKpiSnapshotCollection(): Promise<void> {
  log.debug('Running KPI snapshot collection');
  try {
    const endpoints = await getEndpoints();
    const normalized = endpoints.map(normalizeEndpoint);

    const totals = normalized.reduce(
      (acc, ep) => ({
        endpoints: acc.endpoints + 1,
        endpoints_up: acc.endpoints_up + (ep.status === 'up' ? 1 : 0),
        endpoints_down: acc.endpoints_down + (ep.status === 'down' ? 1 : 0),
        running: acc.running + ep.containersRunning,
        stopped: acc.stopped + ep.containersStopped,
        healthy: acc.healthy + ep.containersHealthy,
        unhealthy: acc.unhealthy + ep.containersUnhealthy,
        total: acc.total + ep.totalContainers,
        stacks: acc.stacks + ep.stackCount,
      }),
      { endpoints: 0, endpoints_up: 0, endpoints_down: 0, running: 0, stopped: 0, healthy: 0, unhealthy: 0, total: 0, stacks: 0 },
    );

    insertKpiSnapshot(totals);
    log.debug('KPI snapshot collected');
  } catch (err) {
    log.error({ err }, 'KPI snapshot collection failed');
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

  try {
    const kpiDeleted = cleanOldKpiSnapshots(getConfig().METRICS_RETENTION_DAYS);
    if (kpiDeleted > 0) {
      log.info({ deleted: kpiDeleted }, 'Old KPI snapshots cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'KPI snapshot cleanup failed');
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

  // Webhook retry processing
  if (config.WEBHOOKS_ENABLED) {
    startWebhookListener();
    const retryIntervalMs = config.WEBHOOKS_RETRY_INTERVAL_SECONDS * 1000;
    log.info(
      { retryIntervalSeconds: config.WEBHOOKS_RETRY_INTERVAL_SECONDS },
      'Starting webhook retry scheduler',
    );
    const webhookRetryInterval = setInterval(async () => {
      try {
        const processed = await processRetries();
        if (processed > 0) {
          log.info({ processed }, 'Webhook retries processed');
        }
      } catch (err) {
        log.error({ err }, 'Webhook retry processing failed');
      }
    }, retryIntervalMs);
    intervals.push(webhookRetryInterval);
  }

  // KPI snapshot collection every 5 minutes (for dashboard sparklines)
  if (config.METRICS_COLLECTION_ENABLED) {
    const kpiIntervalMs = 5 * 60 * 1000;
    log.info('Starting KPI snapshot collection (every 5 minutes)');
    const kpiInterval = setInterval(runKpiSnapshotCollection, kpiIntervalMs);
    intervals.push(kpiInterval);
    // Run once immediately to seed initial data
    runKpiSnapshotCollection().catch(() => {});
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
  stopWebhookListener();
  log.info('Scheduler stopped');
}
