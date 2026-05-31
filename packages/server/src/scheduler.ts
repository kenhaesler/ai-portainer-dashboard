import pLimit from 'p-limit';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getEndpoints, getContainers, getStacksByEndpoint, isEndpointDegraded, getImages, collectFleetOverview } from '@dashboard/core/portainer/index.js';
import { isDockerEndpoint } from '@dashboard/core/models/portainer.js';
import { cachedFetch, cachedFetchSWR, getCacheKey, TTL } from '@dashboard/core/portainer/index.js';
import { normalizeEndpoint, type NormalizedEndpoint } from '@dashboard/core/portainer/index.js';
import { getSetting, setSetting, writeAuditLog, getEffectiveHarborConfig, getEffectiveMonitoringSchedulerConfig, cleanExpiredSessions, cleanExpiredStreamTickets } from '@dashboard/core/services/index.js';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { runWithTraceContext } from '@dashboard/core/tracing/index.js';
import { startCooldownSweep, stopCooldownSweep, cleanupOldInsights, pruneCanaryRegistry, runDedupTelemetryCycle, cleanupOldDedupMetrics, runAnomalyAutoTuneJob } from '@dashboard/ai';
import { initCooldownStore } from '@dashboard/core/services/cooldown-store.js';
import { initPersistenceStore } from '@dashboard/core/services/persistence-store.js';
import { collectMetrics, insertMetrics, cleanOldMetrics, cleanOldSpans, type MetricInsert, recordNetworkSample, insertKpiSnapshot, cleanOldKpiSnapshots, pruneStaleEntries } from '@dashboard/observability';
import { cleanupOldCaptures, cleanupOrphanedSidecars, runStalenessChecks, runHarborSync, isHarborSyncRunning, isHarborConfiguredAsync, cleanupOldVulnerabilities } from '@dashboard/security';
import { createPortainerBackup, cleanupOldPortainerBackups, startWebhookListener, stopWebhookListener, processRetries } from '@dashboard/operations';
import { startElasticsearchLogForwarder, stopElasticsearchLogForwarder } from '@dashboard/infrastructure';

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
  let containerMetricsFailures = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      containerMetricsFailures++;
      continue;
    }
    const { stats, container, containerName } = result.value;
    // Feed in-memory rate tracker (works without TimescaleDB)
    recordNetworkSample(endpointId, container.Id, stats.networkRxBytes, stats.networkTxBytes);
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
  if (containerMetricsFailures > 0) {
    log.warn(
      { failedContainers: containerMetricsFailures, totalContainers: running.length, endpointId },
      'Failed to collect metrics for some containers',
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

    // Skip Kubernetes endpoints (types 5/6/7) — metrics collection uses Docker API.
    // Skip Edge Async endpoints — they lack persistent tunnels for live stats.
    // Also skip endpoints whose circuit breaker is degraded (#694/#695).
    const normalized = endpoints.map(normalizeEndpoint);
    const liveCapableEndpoints = endpoints.filter((_ep, i) => {
      const n = normalized[i];
      return isDockerEndpoint(_ep.Type) && n.capabilities.liveStats && !isEndpointDegraded(_ep.Id);
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
    let endpointMetricsFailures = 0;
    for (let i = 0; i < endpointResults.length; i++) {
      const result = endpointResults[i];
      if (result.status === 'rejected') {
        endpointMetricsFailures++;
        continue;
      }
      metricsToInsert.push(...result.value);
    }
    if (endpointMetricsFailures > 0) {
      log.warn(
        { failedEndpoints: endpointMetricsFailures, totalEndpoints: liveCapableEndpoints.length },
        'Failed to collect metrics for some endpoints',
      );
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

export async function runKpiSnapshotCollection(): Promise<void> {
  log.debug('Running KPI snapshot collection');
  try {
    const { totals } = await collectFleetOverview();
    await insertKpiSnapshot({
      endpoints: totals.endpoints,
      endpoints_up: totals.endpointsUp,
      endpoints_down: totals.endpointsDown,
      running: totals.running,
      stopped: totals.stopped,
      healthy: totals.healthy,
      unhealthy: totals.unhealthy,
      total: totals.total,
      stacks: totals.stacks,
    });
    log.debug('KPI snapshot collected');
  } catch (err) {
    log.error({ err }, 'KPI snapshot collection failed');
  }
}

function makeMonitoringRunner(runMonitoringCycle: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await runMonitoringCycle();
    } catch (err) {
      log.error({ err }, 'Monitoring cycle failed');
    }
  };
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
    const enabledSetting = await getSetting('portainer_backup.enabled');
    if (enabledSetting?.value !== 'true') return;

    const passwordSetting = await getSetting('portainer_backup.password');
    const password = passwordSetting?.value || undefined;

    await createPortainerBackup(password);

    const maxCountSetting = await getSetting('portainer_backup.max_count');
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
    const config = getConfig();
    const { deleted } = await cleanOldSpans(config.TRACES_RETENTION_DAYS);
    if (deleted > 0) {
      log.info({ deleted, retentionDays: config.TRACES_RETENTION_DAYS }, 'Old spans cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Spans cleanup failed');
  }

  try {
    await cleanupOldCaptures();
  } catch (err) {
    log.error({ err }, 'PCAP captures cleanup failed');
  }

  try {
    const endpoints = await cachedFetchSWR(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
    const endpointIds = endpoints.map((ep) => ep.Id);
    await cleanupOrphanedSidecars(endpointIds);
  } catch (err) {
    log.error({ err }, 'Orphaned sidecar cleanup failed');
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
    const sessionsDeleted = await cleanExpiredSessions();
    if (sessionsDeleted > 0) {
      log.info({ deleted: sessionsDeleted }, 'Expired sessions cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Session cleanup failed');
  }

  try {
    const config = getConfig();
    const insightsDeleted = await cleanupOldInsights(config.INSIGHTS_RETENTION_DAYS);
    if (insightsDeleted > 0) {
      log.info({ deleted: insightsDeleted }, 'Old insights cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Insights cleanup failed');
  }

  try {
    const dedupMetricsDeleted = await cleanupOldDedupMetrics(90);
    if (dedupMetricsDeleted > 0) {
      log.info({ deleted: dedupMetricsDeleted }, 'Old dedup telemetry rows cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Dedup telemetry cleanup failed');
  }

  try {
    const vulnDeleted = await cleanupOldVulnerabilities(30);
    if (vulnDeleted > 0) {
      log.info({ deleted: vulnDeleted }, 'Old Harbor vulnerability records cleaned up');
    }
  } catch (err) {
    log.error({ err }, 'Harbor vulnerability cleanup failed');
  }

  // Prune stale entries from the in-memory network rate tracker (issue #1111).
  // Containers that are deleted/recreated with new IDs leave entries in the
  // tracker map indefinitely. Anything older than 2× the metrics collection
  // interval is guaranteed to be stale (we'd have refreshed it otherwise).
  try {
    const config = getConfig();
    const staleMs = config.METRICS_COLLECTION_INTERVAL_SECONDS * 1000 * 2;
    const pruned = pruneStaleEntries(staleMs);
    if (pruned > 0) {
      log.info({ pruned }, 'Stale network rate tracker entries pruned');
    }
  } catch (err) {
    log.error({ err }, 'Network rate tracker pruning failed');
  }

  try {
    // Sweep stale prompt-guard canary registry entries (#1119, critic A3).
    // Ungraceful disconnects (network drop, SIGKILL, lb reconnect) do not
    // fire the socket `disconnect` handler, so the per-session entry
    // would otherwise leak. The TTL matches the assumed upper bound of an
    // LLM chat session.
    const canariesPruned = pruneCanaryRegistry();
    if (canariesPruned > 0) {
      log.info({ deleted: canariesPruned }, 'Stale LLM canary registry entries pruned');
    }
  } catch (err) {
    log.error({ err }, 'Canary registry pruning failed');
  }
}

// ---------------------------------------------------------------------------
// Anomaly threshold auto-tune (#1364) — feedback → threshold loop
// ---------------------------------------------------------------------------

/** Measure the real FP rate from operator feedback and nudge the z-score/robust
 *  threshold toward target. Always computes the recommendation; only APPLIES
 *  (and audits) it when ANOMALY_AUTOTUNE_ENABLED is on. With the flag off it logs
 *  what it would do so operators can preview the loop before opting in. */
async function runAutoTuneCycle(): Promise<void> {
  const cfg = getConfig();
  try {
    const result = await runAnomalyAutoTuneJob({
      enabled: cfg.ANOMALY_AUTOTUNE_ENABLED,
      envThreshold: cfg.ANOMALY_ZSCORE_THRESHOLD,
      targetFpRate: cfg.ANOMALY_AUTOTUNE_TARGET_FP_RATE,
      minSamples: cfg.ANOMALY_AUTOTUNE_MIN_SAMPLES,
      lookbackDays: cfg.ANOMALY_AUTOTUNE_LOOKBACK_DAYS,
      db: getDbForDomain('feedback'),
      getSetting,
      setSetting,
      writeAuditLog,
    });

    if (result.applied) {
      log.info(
        { previous: result.previous, next: result.recommended, rate: result.rate, samples: result.sampleCount, reason: result.reason },
        'Anomaly threshold auto-tuned',
      );
    } else if (result.skipped === 'disabled') {
      // A change was recommended but the flag is off — surface it so operators
      // can see the loop working before enabling auto-apply.
      log.info(
        { previous: result.previous, recommended: result.recommended, rate: result.rate, samples: result.sampleCount, reason: result.reason },
        'Anomaly auto-tune suggests a threshold change (set ANOMALY_AUTOTUNE_ENABLED=true to apply)',
      );
    } else {
      log.debug({ reason: result.reason, rate: result.rate, samples: result.sampleCount }, 'Anomaly auto-tune: no change');
    }
  } catch (err) {
    log.error({ err }, 'Anomaly auto-tune cycle failed');
  }
}

async function waitForPortainer(): Promise<boolean> {
  const maxRetries = 10;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await getEndpoints();
      log.info({ attempt }, 'Portainer connectivity verified');
      return true;
    } catch (err) {
      if (attempt < maxRetries) {
        log.warn({ attempt, maxRetries, err }, 'Waiting for Portainer to be ready...');
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      } else {
        log.error({ err }, 'Portainer not reachable after maximum retries');
        return false;
      }
    }
  }
  return false;
}

export async function warmCache(): Promise<void> {
  log.info('Warming cache: endpoints + containers + stacks');
  try {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
    // Pre-fetch containers + stacks for Docker endpoints only (K8s endpoints use different API)
    const dockerEndpoints = endpoints.filter((ep) => isDockerEndpoint(ep.Type));
    await Promise.allSettled(
      dockerEndpoints.flatMap((ep) => [
        cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => getContainers(ep.Id),
        ),
        cachedFetch(
          getCacheKey('stacks', ep.Id),
          TTL.STACKS,
          () => getStacksByEndpoint(ep.Id),
        ),
      ]),
    );
    log.info({ endpoints: endpoints.length, dockerEndpoints: dockerEndpoints.length }, 'Cache warmed successfully');
  } catch (err) {
    log.warn({ err }, 'Cache warming failed — first requests will be slower');
  }
}

export async function startScheduler(runMonitoringCycle: () => Promise<void>): Promise<void> {
  const config = getConfig();

  // Wait for Portainer to be ready before starting background tasks
  const portainerReady = await waitForPortainer();
  if (!portainerReady) {
    log.warn('Scheduler starting without Portainer connectivity — will retry in background');
  }

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

  // Monitoring scheduler — re-reads config on each 1-minute tick so changes
  // to enabled/intervalMinutes in the Settings UI take effect without a restart.
  {
    let lastMonitoringRunAt = 0;
    const runMonitoringWithErrorHandling = makeMonitoringRunner(runMonitoringCycle);
    const monitoringInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, async () => {
        try {
          const cfg = await getEffectiveMonitoringSchedulerConfig();
          if (!cfg.enabled) return;
          const intervalMs = cfg.intervalMinutes * 60 * 1000;
          if (Date.now() - lastMonitoringRunAt < intervalMs) return;
          lastMonitoringRunAt = Date.now();
          log.debug({ intervalMinutes: cfg.intervalMinutes }, 'Running monitoring cycle');
          await runMonitoringWithErrorHandling();
        } catch (err) {
          log.error({ err }, 'Monitoring scheduler tick failed');
        }
      }),
      60_000, // poll every minute; actual cadence controlled by intervalMinutes
    );
    intervals.push(monitoringInterval);
    // Log once at startup with current config
    getEffectiveMonitoringSchedulerConfig().then((cfg) => {
      log.info(
        { enabled: cfg.enabled, intervalMinutes: cfg.intervalMinutes },
        'Starting dynamic monitoring scheduler (1-min poll)',
      );
    }).catch(() => {});
  }

  // Anomaly threshold auto-tune (#1364) — polls every minute, runs at
  // ANOMALY_AUTOTUNE_INTERVAL_MINUTES cadence. `lastAutoTuneRunAt` starts at
  // "now" so the first run is deferred a full interval (no tuning storm on
  // restart loops). The job is internally gated by ANOMALY_AUTOTUNE_ENABLED.
  {
    let lastAutoTuneRunAt = Date.now();
    const autoTuneInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, async () => {
        try {
          const intervalMs = getConfig().ANOMALY_AUTOTUNE_INTERVAL_MINUTES * 60 * 1000;
          if (Date.now() - lastAutoTuneRunAt < intervalMs) return;
          lastAutoTuneRunAt = Date.now();
          await runAutoTuneCycle();
        } catch (err) {
          log.error({ err }, 'Anomaly auto-tune tick failed');
        }
      }),
      60_000, // poll every minute; actual cadence controlled by interval-minutes
    );
    intervals.push(autoTuneInterval);
    log.info(
      { enabled: config.ANOMALY_AUTOTUNE_ENABLED, intervalMinutes: config.ANOMALY_AUTOTUNE_INTERVAL_MINUTES },
      'Starting anomaly auto-tune scheduler (1-min poll)',
    );
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

  // Harbor vulnerability sync — re-reads config on each 1-minute tick so changes
  // to enabled/syncIntervalMinutes in the Settings UI take effect without a restart.
  {
    let lastHarborSyncAt = 0;
    const harborInterval = setInterval(
      () => runWithTraceContext({ source: 'scheduler' }, async () => {
        try {
          const cfg = await getEffectiveHarborConfig();
          if (!cfg.enabled || !(await isHarborConfiguredAsync())) return;
          const syncIntervalMs = cfg.syncIntervalMinutes * 60 * 1000;
          if (Date.now() - lastHarborSyncAt < syncIntervalMs) return;
          // Skip silently if a sync is already in progress (e.g. triggered via POST /api/harbor/sync)
          if (isHarborSyncRunning()) return;
          lastHarborSyncAt = Date.now();
          const result = await runHarborSync();
          if (result.error) {
            log.warn({ error: result.error }, 'Harbor sync completed with errors');
          }
        } catch (err) {
          log.error({ err }, 'Harbor vulnerability sync failed');
        }
      }),
      60_000, // poll every minute; actual sync cadence is controlled by syncIntervalMinutes
    );
    intervals.push(harborInterval);
    // Run once after warm-up delay if Harbor is already configured at startup
    setTimeout(() => {
      runWithTraceContext({ source: 'scheduler' }, async () => {
        try {
          const cfg = await getEffectiveHarborConfig();
          if (!cfg.enabled || !(await isHarborConfiguredAsync())) return;
          if (isHarborSyncRunning()) return;
          log.info({ intervalMinutes: cfg.syncIntervalMinutes }, 'Starting Harbor vulnerability sync scheduler');
          lastHarborSyncAt = Date.now();
          await runHarborSync();
        } catch { /* logged inside */ }
      }).catch(() => {});
    }, 60_000);
  }

  // Portainer server backup schedule
  const pbEnabledSetting = await getSetting('portainer_backup.enabled');
  if (pbEnabledSetting?.value === 'true') {
    const pbIntervalSetting = await getSetting('portainer_backup.interval_hours');
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

  // Hourly expired-session cleanup (issue #1114). Sessions have a 1h TTL, so a
  // 24h cleanup leaves expired rows in the table for up to 23h. Hourly matches
  // the TTL exactly. The DELETE is idempotent, so the daily runCleanup above
  // remains as a safety net (it'll just delete 0 rows when the hourly already
  // cleared them). cleanExpiredSessions itself is unchanged — only the cadence.
  const sessionCleanupInterval = setInterval(
    () => runWithTraceContext({ source: 'scheduler' }, async () => {
      try {
        const deleted = await cleanExpiredSessions();
        if (deleted > 0) {
          log.info({ deleted }, 'Expired sessions cleaned up (hourly)');
        }
      } catch (err) {
        log.error({ err }, 'Hourly session cleanup failed');
      }
    }),
    60 * 60 * 1000,
  );
  sessionCleanupInterval.unref();
  intervals.push(sessionCleanupInterval);

  // Hourly dedup-engine telemetry (issue #1200). Writes one row per signature
  // to monitoring_dedup_metrics so the next round of dedup tuning is
  // data-driven. Cheap (two indexed aggregates over the 7-day insight window)
  // and bounded (~10 distinct signatures × 24 rows/day).
  const dedupTelemetryInterval = setInterval(
    () => runWithTraceContext({ source: 'scheduler' }, async () => {
      try {
        const result = await runDedupTelemetryCycle();
        if (result.collected > 0) {
          log.info(result, 'Dedup telemetry snapshot written');
        }
      } catch (err) {
        log.error({ err }, 'Hourly dedup telemetry failed');
      }
    }),
    60 * 60 * 1000,
  );
  dedupTelemetryInterval.unref();
  intervals.push(dedupTelemetryInterval);
  // Run once shortly after startup so a freshly-restarted server clears
  // sessions left over from before the restart promptly.
  setTimeout(() => {
    runWithTraceContext({ source: 'scheduler' }, async () => {
      try {
        const deleted = await cleanExpiredSessions();
        if (deleted > 0) {
          log.info({ deleted }, 'Expired sessions cleaned up (startup)');
        }
      } catch (err) {
        log.error({ err }, 'Startup session cleanup failed');
      }
    }).catch(() => {});
  }, 30_000);

  // SSE stream tickets are 30-second TTL and single-use (#1112). Once they
  // expire or are consumed they have no further value and must be purged
  // promptly to keep the table small. A 5-minute sweep is the same cadence
  // used elsewhere for short-lived state.
  const streamTicketCleanupInterval = setInterval(
    () => runWithTraceContext({ source: 'scheduler' }, async () => {
      try {
        const deleted = await cleanExpiredStreamTickets();
        if (deleted > 0) {
          log.debug({ deleted }, 'Expired stream tickets cleaned up');
        }
      } catch (err) {
        log.error({ err }, 'Stream ticket cleanup failed');
      }
    }),
    5 * 60 * 1000,
  );
  streamTicketCleanupInterval.unref();
  intervals.push(streamTicketCleanupInterval);

  // Upgrade anomaly cooldown state to the shared Redis store (#1361 fix 4) so
  // suppression survives restarts and is shared across replicas. Fire-and-forget:
  // the store serves in-memory until this resolves, then stays in-memory if Redis
  // is unavailable.
  void initCooldownStore().catch((err) => log.warn({ err }, 'cooldown store init failed'));
  // Upgrade the M-of-N decision-history store to Redis too (#1363).
  void initPersistenceStore().catch((err) => log.warn({ err }, 'persistence store init failed'));

  // Periodic sweep of expired anomaly cooldowns (every 15 minutes)
  startCooldownSweep();

  // Log process memory usage every 5 minutes at debug level
  const memoryLogInterval = setInterval(() => {
    const mem = process.memoryUsage();
    log.debug({
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
    }, 'Process memory usage (MB)');
  }, 5 * 60 * 1000);
  memoryLogInterval.unref();
  intervals.push(memoryLogInterval);

  // Forward container-origin logs to Elasticsearch when enabled.
  await startElasticsearchLogForwarder();

  log.info({ taskCount: intervals.length }, 'Scheduler started');
}

export function stopScheduler(): void {
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals.length = 0;
  stopCooldownSweep();
  stopElasticsearchLogForwarder();
  stopWebhookListener();
  log.info('Scheduler stopped');
}
