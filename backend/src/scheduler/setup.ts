import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { runMonitoringCycle } from '../services/monitoring-service.js';
import { collectMetrics } from '../services/metrics-collector.js';
import { insertMetrics, cleanOldMetrics, type MetricInsert } from '../services/metrics-store.js';
import { getEndpoints, getContainers } from '../services/portainer-client.js';
import { cleanupOldCaptures } from '../services/pcap-service.js';
import { createPortainerBackup, cleanupOldPortainerBackups } from '../services/portainer-backup.js';
import { getSetting } from '../services/settings-store.js';
import { startWebhookListener, stopWebhookListener, processRetries } from '../services/webhook-service.js';
import { insertKpiSnapshot, cleanOldKpiSnapshots } from '../services/kpi-store.js';
import { normalizeEndpoint } from '../services/portainer-normalizers.js';
import { runStalenessChecks } from '../services/image-staleness.js';
import { getImages } from '../services/portainer-client.js';

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
              {
                endpoint_id: ep.Id,
                container_id: container.Id,
                container_name: containerName,
                metric_type: 'network_rx_bytes',
                value: stats.networkRxBytes,
              },
              {
                endpoint_id: ep.Id,
                container_id: container.Id,
                container_name: containerName,
                metric_type: 'network_tx_bytes',
                value: stats.networkTxBytes,
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

async function runImageStalenessCheck(): Promise<void> {
  log.debug('Running image staleness check');
  try {
    const endpoints = await getEndpoints();
    const allImages: Array<{ name: string; tags: string[]; registry: string; id: string }> = [];

    for (const ep of endpoints) {
      try {
        const images = await getImages(ep.Id);
        for (const img of images) {
          const tags = img.RepoTags?.filter((t: string) => t !== '<none>:<none>') ?? [];
          const firstTag = tags[0] || '<none>';
          const parts = firstTag.split('/');
          let registry = 'docker.io';
          let name = firstTag;
          if (parts.length > 1 && parts[0].includes('.')) {
            registry = parts[0];
            name = parts.slice(1).join('/');
          } else if (parts.length === 1) {
            name = `library/${parts[0]}`;
          }
          const displayName = name.split(':')[0];
          allImages.push({ name: displayName, tags, registry, id: img.Id });
        }
      } catch {
        // skip endpoint
      }
    }

    const result = await runStalenessChecks(allImages);
    log.info(result, 'Image staleness check completed');
  } catch (err) {
    log.error({ err }, 'Image staleness check failed');
  }
}

async function runPortainerBackupSchedule(): Promise<void> {
  try {
    const enabledSetting = getSetting('portainer_backup.enabled');
    if (enabledSetting?.value !== 'true') return;

    const passwordSetting = getSetting('portainer_backup.password');
    const password = passwordSetting?.value || undefined;

    await createPortainerBackup(password);

    const maxCountSetting = getSetting('portainer_backup.max_count');
    const maxCount = parseInt(maxCountSetting?.value ?? '10', 10) || 10;
    cleanupOldPortainerBackups(maxCount);

    log.info('Portainer backup schedule completed');
  } catch (err) {
    log.error({ err }, 'Portainer backup schedule failed');
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

  // Image staleness checks
  if (config.IMAGE_STALENESS_CHECK_ENABLED) {
    const stalenessIntervalMs = config.IMAGE_STALENESS_CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
    log.info(
      { intervalHours: config.IMAGE_STALENESS_CHECK_INTERVAL_HOURS },
      'Starting image staleness checker',
    );
    const stalenessInterval = setInterval(runImageStalenessCheck, stalenessIntervalMs);
    intervals.push(stalenessInterval);
    // Run once after a short delay to let the system warm up
    setTimeout(() => { runImageStalenessCheck().catch(() => {}); }, 30_000);
  }

  // Portainer server backup schedule
  const pbEnabledSetting = getSetting('portainer_backup.enabled');
  if (pbEnabledSetting?.value === 'true') {
    const pbIntervalSetting = getSetting('portainer_backup.interval_hours');
    const pbIntervalHours = parseInt(pbIntervalSetting?.value ?? '24', 10) || 24;
    const pbIntervalMs = pbIntervalHours * 60 * 60 * 1000;
    log.info(
      { intervalHours: pbIntervalHours },
      'Starting Portainer backup scheduler',
    );
    const pbInterval = setInterval(runPortainerBackupSchedule, pbIntervalMs);
    intervals.push(pbInterval);
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
