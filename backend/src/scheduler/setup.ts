import pLimit from 'p-limit';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { runMonitoringCycle } from '../services/monitoring-service.js';
import { collectMetrics } from '../services/metrics-collector.js';
import { insertMetrics, cleanOldMetrics, type MetricInsert } from '../services/metrics-store.js';
import { getEndpoints, getContainers } from '../services/portainer-client.js';
import { cachedFetch, cachedFetchSWR, getCacheKey, TTL } from '../services/portainer-cache.js';
import { cleanupOldCaptures } from '../services/pcap-service.js';
import { createPortainerBackup, cleanupOldPortainerBackups } from '../services/portainer-backup.js';
import { getSetting } from '../services/settings-store.js';
import { startWebhookListener, stopWebhookListener, processRetries } from '../services/webhook-service.js';
import { insertKpiSnapshot, cleanOldKpiSnapshots } from '../services/kpi-store.js';
import { normalizeEndpoint, type NormalizedEndpoint } from '../services/portainer-normalizers.js';
import { runStalenessChecks } from '../services/image-staleness.js';
import { getImages } from '../services/portainer-client.js';
import { runWithTraceContext } from '../services/trace-context.js';
import { startElasticsearchLogForwarder, stopElasticsearchLogForwarder } from '../services/elasticsearch-log-forwarder.js';
import { cleanExpiredSessions } from '../services/session-store.js';

const log = createChildLogger('scheduler');

const intervals: NodeJS.Timeout[] = [];

// ---------------------------------------------------------------------------
// Mutex guard — prevents overlapping metrics collection cycles
// ---------------------------------------------------------------------------
let metricsCollectionRunning = false;

/** Exposed for testing — check whether a cycle is currently in progress. */
export function isMetricsCycleRunning(): boolean {
  return metricsCollectionRunning;
}

/** Exposed for testing — forcibly reset the mutex (e.g. between test runs). */
export function _resetMetricsMutex(): void {
  metricsCollectionRunning = false;
}

// ---------------------------------------------------------------------------
// Metrics collection — endpoints + containers processed in parallel
// ---------------------------------------------------------------------------

/** Collect metrics for a single endpoint's running containers.
 *  Returns an array of MetricInsert rows ready for batch insert.
 */
async function collectEndpointMetrics(
  endpointId: number,
  containerConcurrency: number,
): Promise<MetricInsert[]> {
  const containers = await cachedFetchSWR(
    getCacheKey('containers', endpointId),
    TTL.CONTAINERS,
    () => getContainers(endpointId),
  );
  const running = containers.filter((c) => c.State === 'running');

  const containerLimit = pLimit(containerConcurrency);
  const results = await Promise.allSettled(
    running.map((container) =>
      containerLimit(async () => {
        const stats = await collectMetrics(endpointId, container.Id);
        const containerName =
          container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);
        return { stats, container, containerName };
      }),
    ),
  );

  const metrics: MetricInsert[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      log.warn({ err: result.reason }, 'Failed to collect metrics for container');
      continue;
    }
    const { stats, container, containerName } = result.value;
    metrics.push(
      {
        endpoint_id: endpointId,
        container_id: container.Id,
        container_name: containerName,
        metric_type: 'cpu',
        value: stats.cpu,
      },
      {
        endpoint_id: endpointId,
        container_id: container.Id,
        container_name: containerName,
        metric_type: 'memory',
        value: stats.memory,
      },
      {
        endpoint_id: endpointId,
        container_id: container.Id,
        container_name: containerName,
        metric_type: 'memory_bytes',
        value: stats.memoryBytes,
      },
      {
        endpoint_id: endpointId,
        container_id: container.Id,
        container_name: containerName,
        metric_type: 'network_rx_bytes',
        value: stats.networkRxBytes,
      },
      {
        endpoint_id: endpointId,
        container_id: container.Id,
        container_name: containerName,
        metric_type: 'network_tx_bytes',
        value: stats.networkTxBytes,
      },
    );
  }
  return metrics;
}

export async function runMetricsCollection(): Promise<void> {
  // Mutex guard — skip this cycle if the previous one is still in progress
  if (metricsCollectionRunning) {
    log.warn('Metrics collection cycle still running, skipping this tick');
    return;
  }
  metricsCollectionRunning = true;
  const startTime = Date.now();

  try {
    log.debug('Running metrics collection cycle');
    const config = getConfig();

    const endpoints = await cachedFetchSWR(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );

    // Skip Edge Async endpoints — they lack persistent tunnels for live stats
    const normalized = endpoints.map(normalizeEndpoint);
    const liveCapableEndpoints = endpoints.filter((_ep, i) => {
      const n = normalized[i];
      return n.capabilities.liveStats;
    });

    if (liveCapableEndpoints.length < endpoints.length) {
      log.debug(
        { skipped: endpoints.length - liveCapableEndpoints.length },
        'Skipping Edge Async endpoints for metrics collection',
      );
    }

    // Process endpoints in parallel, bounded by METRICS_ENDPOINT_CONCURRENCY
    const endpointLimit = pLimit(config.METRICS_ENDPOINT_CONCURRENCY);
    const endpointResults = await Promise.allSettled(
      liveCapableEndpoints.map((ep) =>
        endpointLimit(() =>
          collectEndpointMetrics(ep.Id, config.METRICS_CONTAINER_CONCURRENCY),
        ),
      ),
    );

    const metricsToInsert: MetricInsert[] = [];
    for (const result of endpointResults) {
      if (result.status === 'rejected') {
        log.warn({ err: result.reason }, 'Failed to collect metrics for endpoint');
        continue;
      }
      metricsToInsert.push(...result.value);
    }

    if (metricsToInsert.length > 0) {
      await insertMetrics(metricsToInsert);
    }

    const duration = Date.now() - startTime;
    log.debug(
      { metricsCount: metricsToInsert.length, durationMs: duration, endpoints: liveCapableEndpoints.length },
      'Metrics collection cycle completed',
    );
  } catch (err) {
    log.error({ err }, 'Metrics collection cycle failed');
  } finally {
    metricsCollectionRunning = false;
  }
}

async function runKpiSnapshotCollection(): Promise<void> {
  log.debug('Running KPI snapshot collection');
  try {
    const endpoints = await cachedFetchSWR(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
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

    await insertKpiSnapshot(totals);
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

export async function runImageStalenessCheck(): Promise<void> {
  log.debug('Running image staleness check');
  try {
    const config = getConfig();
    const endpoints = await cachedFetchSWR(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );

    // Process endpoints in parallel, bounded by METRICS_ENDPOINT_CONCURRENCY
    const endpointLimit = pLimit(config.METRICS_ENDPOINT_CONCURRENCY);
    const endpointResults = await Promise.allSettled(
      endpoints.map((ep) =>
        endpointLimit(async () => {
          const images = await cachedFetchSWR(
            getCacheKey('images', ep.Id),
            TTL.IMAGES,
            () => getImages(ep.Id),
          );
          const parsed: Array<{ name: string; tags: string[]; registry: string; id: string }> = [];
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
            parsed.push({ name: displayName, tags, registry, id: img.Id });
          }
          return parsed;
        }),
      ),
    );

    const allImages: Array<{ name: string; tags: string[]; registry: string; id: string }> = [];
    for (const result of endpointResults) {
      if (result.status === 'fulfilled') {
        allImages.push(...result.value);
      }
      // Silently skip failed endpoints (matches previous behaviour)
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

export async function runCleanup(): Promise<void> {
  try {
    const config = getConfig();
    const deleted = await cleanOldMetrics(config.METRICS_RETENTION_DAYS);
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
    const kpiDeleted = await cleanOldKpiSnapshots(getConfig().METRICS_RETENTION_DAYS);
    if (kpiDeleted > 0) {
      log.info({ deleted: kpiDeleted }, 'Old KPI snapshots cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'KPI snapshot cleanup failed');
  }

  try {
    const sessionsDeleted = cleanExpiredSessions();
    if (sessionsDeleted > 0) {
      log.info({ deleted: sessionsDeleted }, 'Expired sessions cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Session cleanup failed');
  }
}

async function warmCache(): Promise<void> {
  log.info('Warming cache: endpoints + containers');
  try {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
    // Pre-fetch containers for all endpoints in parallel
    await Promise.allSettled(
      endpoints.map((ep) =>
        cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => getContainers(ep.Id),
        ),
      ),
    );
    log.info({ endpoints: endpoints.length }, 'Cache warmed successfully');
  } catch (err) {
    log.warn({ err }, 'Cache warming failed — first requests will be slower');
  }
}

export function startScheduler(): void {
  const config = getConfig();

  // Warm cache immediately to avoid thundering herd on first requests
  warmCache().catch(() => {});

  if (config.METRICS_COLLECTION_ENABLED) {
    const metricsIntervalMs = config.METRICS_COLLECTION_INTERVAL_SECONDS * 1000;
    log.info(
      {
        intervalSeconds: config.METRICS_COLLECTION_INTERVAL_SECONDS,
        endpointConcurrency: config.METRICS_ENDPOINT_CONCURRENCY,
        containerConcurrency: config.METRICS_CONTAINER_CONCURRENCY,
      },
      'Starting metrics collection scheduler',
    );
    const metricsInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, runMetricsCollection),
      metricsIntervalMs,
    );
    intervals.push(metricsInterval);
    // Run one collection immediately so dashboards don't wait for first interval tick.
    runWithTraceContext({ source: 'scheduler' }, runMetricsCollection).catch(() => {});
  }

  if (config.MONITORING_ENABLED) {
    const monitoringIntervalMs = config.MONITORING_INTERVAL_MINUTES * 60 * 1000;
    log.info(
      { intervalMinutes: config.MONITORING_INTERVAL_MINUTES },
      'Starting monitoring scheduler',
    );
    const monitoringInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, runMonitoringWithErrorHandling),
      monitoringIntervalMs,
    );
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
    const webhookRetryInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, async () => {
        try {
          const processed = await processRetries();
          if (processed > 0) {
            log.info({ processed }, 'Webhook retries processed');
          }
        } catch (err) {
          log.error({ err }, 'Webhook retry processing failed');
        }
      }),
      retryIntervalMs,
    );
    intervals.push(webhookRetryInterval);
  }

  // KPI snapshot collection every 5 minutes (for dashboard sparklines)
  if (config.METRICS_COLLECTION_ENABLED) {
    const kpiIntervalMs = 5 * 60 * 1000;
    log.info('Starting KPI snapshot collection (every 5 minutes)');
    const kpiInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, runKpiSnapshotCollection),
      kpiIntervalMs,
    );
    intervals.push(kpiInterval);
    // Run once immediately to seed initial data
    runWithTraceContext({ source: 'scheduler' }, runKpiSnapshotCollection).catch(() => {});
  }

  // Image staleness checks
  if (config.IMAGE_STALENESS_CHECK_ENABLED) {
    const stalenessIntervalMs = config.IMAGE_STALENESS_CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
    log.info(
      { intervalHours: config.IMAGE_STALENESS_CHECK_INTERVAL_HOURS },
      'Starting image staleness checker',
    );
    const stalenessInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, runImageStalenessCheck),
      stalenessIntervalMs,
    );
    intervals.push(stalenessInterval);
    // Run once after a short delay to let the system warm up
    setTimeout(() => { runWithTraceContext({ source: 'scheduler' }, runImageStalenessCheck).catch(() => {}); }, 30_000);
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
    const pbInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, runPortainerBackupSchedule),
      pbIntervalMs,
    );
    intervals.push(pbInterval);
  }

  // Cleanup old metrics once per day
  const cleanupInterval = setInterval(
    () => runWithTraceContext({ source: 'scheduler' }, runCleanup),
    24 * 60 * 60 * 1000,
  );
  intervals.push(cleanupInterval);

  // Forward container-origin logs to Elasticsearch when enabled.
  startElasticsearchLogForwarder();

  log.info({ taskCount: intervals.length }, 'Scheduler started');
}

export function stopScheduler(): void {
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals.length = 0;
  stopElasticsearchLogForwarder();
  stopWebhookListener();
  log.info('Scheduler stopped');
}
