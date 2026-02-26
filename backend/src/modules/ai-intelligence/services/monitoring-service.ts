import { v4 as uuidv4 } from 'uuid';
import type { Namespace } from 'socket.io';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getEndpoints, getContainers, isEndpointDegraded, isCircuitOpen } from '@dashboard/core/portainer/portainer-client.js';
import { CircuitBreakerOpenError } from '@dashboard/core/portainer/circuit-breaker.js';
import { cachedFetchSWR, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeEndpoint, normalizeContainer } from '@dashboard/core/portainer/portainer-normalizers.js';
// Phase 3 TODO: replace cross-domain imports with inter-module contracts / event bus
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts security interface
import { scanContainer } from '../../security/index.js'; // cross-domain: security → ai-intelligence
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts observability interface
import { getLatestMetricsBatch } from '../../observability/index.js'; // cross-domain: observability → ai-intelligence
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts observability interface
import type { MetricInsert } from '../../observability/index.js';
import { detectAnomalyAdaptive, detectAnomaliesBatch } from './adaptive-anomaly-detector.js';
import type { BatchDetectionItem } from './adaptive-anomaly-detector.js';
import { detectAnomalyIsolationForest } from './isolation-forest-detector.js';
import { insertInsight, insertInsights, getRecentInsights, type InsightInsert } from './insights-store.js';
import { isOllamaAvailable, chatStream, buildInfrastructureContext } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts operations interface
import { suggestAction } from '../../operations/index.js'; // cross-domain: operations → ai-intelligence
import { triggerInvestigation } from './investigation-service.js';
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts observability interface
import { getCapacityForecasts } from '../../observability/index.js'; // cross-domain: observability → ai-intelligence
import { explainAnomalies } from './anomaly-explainer.js';
import { analyzeLogsForContainers } from './log-analyzer.js';
import { insertMonitoringCycle, insertMonitoringSnapshot } from './monitoring-telemetry-store.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts security interface
import type { SecurityFinding } from '../../security/index.js';
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts operations interface
import { notifyInsight } from '../../operations/index.js'; // cross-domain: operations → ai-intelligence
import { eventBus } from '@dashboard/core/services/typed-event-bus.js';
import { correlateInsights } from './incident-correlator.js';

const log = createChildLogger('monitoring-service');

// Per-container+metric cooldown tracker: key = `${containerId}:${metricType}`, value = timestamp (ms)
const anomalyCooldowns = new Map<string, number>();

// Track previous cycle stats for delta-based logging
let previousCycleStats: Record<string, number> | null = null;

/** Exposed for testing — reset previous cycle stats. */
export function resetPreviousCycleStats(): void {
  previousCycleStats = null;
}

/** Clear all cooldown entries (used in tests). */
export function resetAnomalyCooldowns(): void {
  anomalyCooldowns.clear();
}

const COOLDOWN_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let cooldownSweepTimer: ReturnType<typeof setInterval> | undefined;

/** Remove expired entries from the anomalyCooldowns map. */
export function sweepExpiredCooldowns(cooldownMinutes: number): number {
  const cooldownMs = cooldownMinutes * 60_000;
  const now = Date.now();
  let swept = 0;
  for (const [key, timestamp] of anomalyCooldowns) {
    if (now - timestamp >= cooldownMs) {
      anomalyCooldowns.delete(key);
      swept++;
    }
  }
  if (swept > 0) {
    log.debug({ swept, remaining: anomalyCooldowns.size }, 'Swept expired anomaly cooldowns');
  }
  return swept;
}

/** Start periodic sweep of expired anomaly cooldowns (every 15 minutes). */
export function startCooldownSweep(): void {
  if (cooldownSweepTimer) return;
  cooldownSweepTimer = setInterval(() => {
    try {
      const config = getConfig();
      sweepExpiredCooldowns(config.ANOMALY_COOLDOWN_MINUTES);
    } catch {
      // Config may not be available during shutdown
    }
  }, COOLDOWN_SWEEP_INTERVAL_MS);
  cooldownSweepTimer.unref();
}

/** Stop periodic cooldown sweep. */
export function stopCooldownSweep(): void {
  if (cooldownSweepTimer) {
    clearInterval(cooldownSweepTimer);
    cooldownSweepTimer = undefined;
  }
}

let monitoringNamespace: Namespace | null = null;

export function setMonitoringNamespace(ns: Namespace): void {
  monitoringNamespace = ns;
  log.info('Monitoring namespace registered for real-time broadcasting');
}

function broadcastInsight(insight: Insight): void {
  if (!monitoringNamespace) return;

  // Broadcast to all clients subscribed to this severity
  monitoringNamespace.to(`severity:${insight.severity}`).emit('insights:new', insight);
  monitoringNamespace.to('severity:all').emit('insights:new', insight);
}

function classifySeverity(findings: SecurityFinding[]): 'critical' | 'warning' | 'info' {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  return 'info';
}

export async function runMonitoringCycle(): Promise<void> {
  log.info('Starting monitoring cycle');
  const startTime = Date.now();

  try {
    // 1. Collect snapshot of all endpoints and containers (cached to avoid duplicating scheduler fetches)
    const rawEndpoints = await cachedFetchSWR(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
    const endpoints = rawEndpoints.map(normalizeEndpoint);

    const allContainers: Array<{
      raw: Awaited<ReturnType<typeof getContainers>>[number];
      endpointId: number;
      endpointName: string;
    }> = [];

    // Fetch containers for all endpoints in parallel (they are cached by the scheduler)
    // Skip endpoints with open or degraded circuit breakers — #694/#695/#759
    let skippedCb = 0;
    const activeEndpoints = rawEndpoints.filter((ep) => {
      if (isCircuitOpen(ep.Id) || isEndpointDegraded(ep.Id)) {
        skippedCb++;
        return false;
      }
      return true;
    });
    if (skippedCb > 0) {
      log.debug(
        { skippedCb, totalEndpoints: rawEndpoints.length },
        'Skipping endpoints with open circuit breakers in monitoring cycle',
      );
    }

    const containerResults = await Promise.allSettled(
      activeEndpoints.map(async (ep) => {
        const containers = await cachedFetchSWR(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => getContainers(ep.Id),
        );
        return containers.map((c) => ({ raw: c, endpointId: ep.Id, endpointName: ep.Name }));
      }),
    );
    let containerFetchFailures = 0;
    let circuitBreakerSkips = 0;
    for (const result of containerResults) {
      if (result.status === 'fulfilled') {
        allContainers.push(...result.value);
      } else {
        if (result.reason instanceof CircuitBreakerOpenError) {
          circuitBreakerSkips++;
        } else {
          containerFetchFailures++;
        }
      }
    }
    if (containerFetchFailures > 0) {
      log.warn(
        { failedEndpoints: containerFetchFailures, totalEndpoints: activeEndpoints.length },
        'Failed to fetch containers for some endpoints',
      );
    }
    if (circuitBreakerSkips > 0) {
      log.debug(
        { circuitBreakerSkips, totalEndpoints: activeEndpoints.length },
        'Skipped endpoints with open circuit breakers',
      );
    }

    const normalizedContainers = allContainers.map((c) =>
      normalizeContainer(c.raw, c.endpointId, c.endpointName),
    );

    await insertMonitoringSnapshot({
      containersRunning: normalizedContainers.filter((c) => c.state === 'running').length,
      containersStopped: normalizedContainers.filter((c) => c.state === 'stopped').length,
      containersUnhealthy: endpoints.reduce((acc, endpoint) => acc + endpoint.containersUnhealthy, 0),
      endpointsUp: endpoints.filter((endpoint) => endpoint.status === 'up').length,
      endpointsDown: endpoints.filter((endpoint) => endpoint.status === 'down').length,
    });

    // 2. Read latest metrics from DB (scheduler collects every 60s — avoid duplicate API calls)
    const edgeAsyncEndpointIds = new Set(
      endpoints.filter((ep) => !ep.capabilities.liveStats).map((ep) => ep.id),
    );
    const metricsFromDb: MetricInsert[] = [];
    const runningContainers = allContainers.filter(
      (c) => c.raw.State === 'running' && !edgeAsyncEndpointIds.has(c.endpointId),
    );

    // Single batch query instead of N per-container calls
    const containerIds = runningContainers.map((c) => c.raw.Id);
    let batchMetrics: Map<string, Record<string, number>>;
    try {
      batchMetrics = await getLatestMetricsBatch(containerIds);
    } catch {
      log.warn(
        { containerCount: containerIds.length },
        'Failed to read latest metrics batch — skipping DB metrics for this cycle',
      );
      batchMetrics = new Map();
    }

    for (const container of runningContainers) {
      const latest = batchMetrics.get(container.raw.Id) ?? {};
      const containerName =
        container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

      if (latest.cpu !== undefined) {
        metricsFromDb.push({
          endpoint_id: container.endpointId,
          container_id: container.raw.Id,
          container_name: containerName,
          metric_type: 'cpu',
          value: latest.cpu,
        });
      }
      if (latest.memory !== undefined) {
        metricsFromDb.push({
          endpoint_id: container.endpointId,
          container_id: container.raw.Id,
          container_name: containerName,
          metric_type: 'memory',
          value: latest.memory,
        });
      }
      if (latest.memory_bytes !== undefined) {
        metricsFromDb.push({
          endpoint_id: container.endpointId,
          container_id: container.raw.Id,
          container_name: containerName,
          metric_type: 'memory_bytes',
          value: latest.memory_bytes,
        });
      }
    }

    // 3. Run security scan on all containers
    const allFindings: Array<{
      finding: SecurityFinding;
      endpointId: number;
      endpointName: string;
      containerId: string;
      containerName: string;
    }> = [];

    for (const container of allContainers) {
      const findings = scanContainer(container.raw);
      const containerName =
        container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);
      for (const finding of findings) {
        allFindings.push({
          finding,
          endpointId: container.endpointId,
          endpointName: container.endpointName,
          containerId: container.raw.Id,
          containerName,
        });
      }
    }

    // 4. Run anomaly detection on recent metrics (batched)
    const config = getConfig();
    const anomalyInsights: InsightInsert[] = [];

    // Build batch items for all running containers × metric types
    const batchItems: (BatchDetectionItem & { endpointId: number; endpointName: string })[] = [];
    for (const container of runningContainers) {
      const containerName =
        container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

      for (const metricType of ['cpu', 'memory'] as const) {
        const metric = metricsFromDb.find(
          (m) => m.container_id === container.raw.Id && m.metric_type === metricType,
        );
        if (!metric) continue;

        batchItems.push({
          containerId: container.raw.Id,
          containerName,
          metricType,
          currentValue: metric.value,
          endpointId: container.endpointId,
          endpointName: container.endpointName,
        });
      }
    }

    // Run batch anomaly detection
    const batchResults = await detectAnomaliesBatch(
      batchItems,
      config.ANOMALY_DETECTION_METHOD,
    );

    // Process batch results with cooldown checks
    for (const item of batchItems) {
      const key = `${item.containerId}:${item.metricType}`;
      const anomaly = batchResults.get(key);
      if (!anomaly?.is_anomalous) continue;

      // Cooldown check: skip if this container+metric was recently flagged
      const cooldownKey = key;
      const cooldownMs = config.ANOMALY_COOLDOWN_MINUTES * 60_000;
      const lastAlerted = anomalyCooldowns.get(cooldownKey);
      if (cooldownMs > 0 && lastAlerted && Date.now() - lastAlerted < cooldownMs) {
        log.debug(
          { containerId: item.containerId, metricType: item.metricType, cooldownMinutes: config.ANOMALY_COOLDOWN_MINUTES },
          'Anomaly suppressed by cooldown',
        );
        continue;
      }
      anomalyCooldowns.set(cooldownKey, Date.now());

      anomalyInsights.push({
        id: uuidv4(),
        endpoint_id: item.endpointId,
        endpoint_name: item.endpointName,
        container_id: item.containerId,
        container_name: item.containerName,
        severity: Math.abs(anomaly.z_score) > 4 ? 'critical' : 'warning',
        category: 'anomaly',
        title: `Anomalous ${item.metricType} usage on "${item.containerName}"`,
        description:
          `Current ${item.metricType}: ${anomaly.current_value.toFixed(1)}% ` +
          `(mean: ${anomaly.mean.toFixed(1)}%, z-score: ${anomaly.z_score.toFixed(2)}, ` +
          `method: ${anomaly.method ?? 'zscore'}). ` +
          `This is ${Math.abs(anomaly.z_score).toFixed(1)} standard deviations from the moving average.`,
        suggested_action: item.metricType === 'memory'
          ? 'Investigate memory usage patterns and check container configuration'
          : 'Investigate CPU usage patterns and check for process anomalies',
      });
    }

    // 4.05. Threshold-based detection — flag values above ANOMALY_THRESHOLD_PCT.
    // This catches high values that z-score misses (e.g. container consistently at 100%).
    if (config.ANOMALY_HARD_THRESHOLD_ENABLED !== false) {
      for (const container of runningContainers) {
        const containerName =
          container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

        for (const metricType of ['cpu', 'memory'] as const) {
          const metric = metricsFromDb.find(
            (m) => m.container_id === container.raw.Id && m.metric_type === metricType,
          );
          if (!metric || metric.value <= config.ANOMALY_THRESHOLD_PCT) continue;

          // Skip if already flagged by statistical detection
          if (anomalyInsights.some(
            (a) => a.container_id === container.raw.Id && a.title.toLowerCase().includes(metricType),
          )) continue;

          // Cooldown check
          const cooldownKey = `${container.raw.Id}:${metricType}:threshold`;
          const cooldownMs = config.ANOMALY_COOLDOWN_MINUTES * 60_000;
          const lastAlerted = anomalyCooldowns.get(cooldownKey);
          if (cooldownMs > 0 && lastAlerted && Date.now() - lastAlerted < cooldownMs) continue;
          anomalyCooldowns.set(cooldownKey, Date.now());

          anomalyInsights.push({
            id: uuidv4(),
            endpoint_id: container.endpointId,
            endpoint_name: container.endpointName,
            container_id: container.raw.Id,
            container_name: containerName,
            severity: metric.value > 95 ? 'critical' : 'warning',
            category: 'anomaly',
            title: `High ${metricType} usage on "${containerName}"`,
            description:
              `Current ${metricType}: ${metric.value.toFixed(1)}% ` +
              `(threshold: ${config.ANOMALY_THRESHOLD_PCT}%). ` +
              `Value exceeds the configured warning threshold.`,
            suggested_action: metricType === 'memory'
              ? 'Check for memory leaks or increase memory limit'
              : 'Check for runaway processes or increase CPU allocation',
          });
        }
      }
    }

    // 4.1. Isolation Forest anomaly detection — multivariate ML-based detection
    if (config.ISOLATION_FOREST_ENABLED) {
      for (const container of runningContainers) {
        const containerName =
          container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

        const cpuMetric = metricsFromDb.find(
          (m) => m.container_id === container.raw.Id && m.metric_type === 'cpu',
        );
        const memMetric = metricsFromDb.find(
          (m) => m.container_id === container.raw.Id && m.metric_type === 'memory',
        );
        if (!cpuMetric || !memMetric) continue;

        // Skip if already flagged by statistical detection
        if (anomalyInsights.some((a) => a.container_id === container.raw.Id)) continue;

        for (const metricType of ['cpu', 'memory'] as const) {
          const value = metricType === 'cpu' ? cpuMetric.value : memMetric.value;
          const ifAnomaly = await detectAnomalyIsolationForest(
            container.raw.Id, containerName, metricType, value,
            cpuMetric.value, memMetric.value,
          );
          if (ifAnomaly?.is_anomalous) {
            anomalyInsights.push({
              id: uuidv4(),
              endpoint_id: container.endpointId,
              endpoint_name: container.endpointName,
              container_id: container.raw.Id,
              container_name: containerName,
              severity: ifAnomaly.z_score > 0.7 ? 'critical' : 'warning',
              category: 'anomaly',
              title: `Anomalous ${metricType} usage on "${containerName}" (ML-detected)`,
              description:
                `Isolation Forest anomaly score: ${ifAnomaly.z_score.toFixed(2)} ` +
                `(cpu: ${cpuMetric.value.toFixed(1)}%, memory: ${memMetric.value.toFixed(1)}%, ` +
                `method: isolation-forest). ` +
                `Multivariate analysis detected unusual resource usage pattern.`,
              suggested_action: metricType === 'memory'
                ? 'Check for memory leaks or increase memory limit'
                : 'Check for runaway processes or increase CPU allocation',
            });
            break; // One insight per container for IF detection
          }
        }
      }
    }

    // 4.5. Predictive alerting — proactive resource exhaustion warnings
    const predictiveInsights: InsightInsert[] = [];
    if (config.PREDICTIVE_ALERTING_ENABLED) {
      try {
        const forecasts = await getCapacityForecasts(20);
        for (const forecast of forecasts) {
          if (
            forecast.trend === 'increasing' &&
            forecast.timeToThreshold != null &&
            forecast.timeToThreshold <= config.PREDICTIVE_ALERT_THRESHOLD_HOURS &&
            forecast.confidence !== 'low'
          ) {
            const severity: 'critical' | 'warning' | 'info' =
              forecast.timeToThreshold < 4 ? 'critical' :
              forecast.timeToThreshold < 12 ? 'warning' : 'info';

            predictiveInsights.push({
              id: uuidv4(),
              endpoint_id: null,
              endpoint_name: null,
              container_id: forecast.containerId,
              container_name: forecast.containerName,
              severity,
              category: 'predictive',
              title: `Predicted ${forecast.metricType} exhaustion on "${forecast.containerName}" in ~${forecast.timeToThreshold}h`,
              description:
                `${forecast.metricType} is trending upward (slope: ${forecast.slope.toFixed(3)}/h, R²: ${forecast.r_squared.toFixed(2)}). ` +
                `Current: ${forecast.currentValue.toFixed(1)}%. Estimated time to 90% threshold: ~${forecast.timeToThreshold}h. ` +
                `Confidence: ${forecast.confidence}.`,
              suggested_action: forecast.metricType === 'memory'
                ? 'Consider increasing memory limits or investigating memory consumption patterns before threshold is reached'
                : 'Consider scaling CPU resources or optimizing workload before threshold is reached',
            });
          }
        }
        if (predictiveInsights.length > 0) {
          log.info({ count: predictiveInsights.length }, 'Predictive alerts generated');
        }
      } catch (err) {
        log.warn({ err }, 'Predictive alerting failed');
      }
    }

    // 4.75. Anomaly explanations — LLM explains anomalies in plain English
    const ollamaAvailable = await isOllamaAvailable();
    if (config.ANOMALY_EXPLANATION_ENABLED && ollamaAvailable && anomalyInsights.length > 0) {
      try {
        const anomalyData = anomalyInsights.map((ins) => ({
          insight: ins,
          description: ins.description,
        }));
        const explanations = await explainAnomalies(anomalyData, config.ANOMALY_EXPLANATION_MAX_PER_CYCLE);
        for (const [insightId, explanation] of explanations) {
          const insight = anomalyInsights.find((i) => i.id === insightId);
          if (insight) {
            insight.description += `\n\nAI Analysis: ${explanation}`;
          }
        }
        if (explanations.size > 0) {
          log.info({ count: explanations.size }, 'Anomaly explanations generated');
        }
      } catch (err) {
        log.warn({ err }, 'Anomaly explanation failed');
      }
    }

    // 4.8. NLP Log Analysis — LLM analyzes container logs for error patterns
    const logAnalysisInsights: InsightInsert[] = [];
    if (config.NLP_LOG_ANALYSIS_ENABLED && ollamaAvailable && runningContainers.length > 0) {
      try {
        const containersForLogAnalysis = runningContainers.map((c) => ({
          endpointId: c.endpointId,
          containerId: c.raw.Id,
          containerName: c.raw.Names?.[0]?.replace(/^\//, '') || c.raw.Id.slice(0, 12),
        }));
        const logResults = await analyzeLogsForContainers(
          containersForLogAnalysis,
          config.NLP_LOG_ANALYSIS_MAX_PER_CYCLE,
          config.NLP_LOG_ANALYSIS_TAIL_LINES,
        );
        for (const result of logResults) {
          const container = runningContainers.find((c) => c.raw.Id === result.containerId);
          logAnalysisInsights.push({
            id: uuidv4(),
            endpoint_id: container?.endpointId ?? null,
            endpoint_name: container?.endpointName ?? null,
            container_id: result.containerId,
            container_name: result.containerName,
            severity: result.severity,
            category: 'log-analysis',
            title: `Log issues detected in "${result.containerName}"`,
            description:
              `${result.summary}` +
              (result.errorPatterns.length > 0
                ? `\n\nError patterns: ${result.errorPatterns.join(', ')}`
                : ''),
            suggested_action: 'Review container logs for the identified error patterns and address the root cause',
          });
        }
        if (logAnalysisInsights.length > 0) {
          log.info({ count: logAnalysisInsights.length }, 'NLP log analysis insights generated');
        }
      } catch (err) {
        log.warn({ err }, 'NLP log analysis failed');
      }
    }

    // 5. Create insights from security findings
    const securityInsights: InsightInsert[] = allFindings.map((f) => ({
      id: uuidv4(),
      endpoint_id: f.endpointId,
      endpoint_name: f.endpointName,
      container_id: f.containerId,
      container_name: f.containerName,
      severity: f.finding.severity,
      category: `security:${f.finding.category}`,
      title: f.finding.title,
      description: f.finding.description,
      suggested_action: null,
    }));

    // 6. Attempt AI analysis (fire-and-forget, gated by AI_ANALYSIS_ENABLED)
    if (config.AI_ANALYSIS_ENABLED && ollamaAvailable) {
      // Fire-and-forget: AI analysis inserts its own insight when complete
      (async () => {
        try {
          const recentInsights = await getRecentInsights(60);
          const infraContext = buildInfrastructureContext(endpoints, normalizedContainers, recentInsights);
          const userPrompt = await getEffectivePrompt('monitoring_analysis');
          const systemPrompt = `${infraContext}\n\n${userPrompt}`;

          const analysisPrompt =
            'Analyze the current infrastructure state. Identify the top 3 most important ' +
            'issues or recommendations. Be specific and actionable. Format each as a brief title and description.';

          let aiResponse = '';
          await chatStream(
            [{ role: 'user', content: analysisPrompt }],
            systemPrompt,
            (chunk) => { aiResponse += chunk; },
          );

          if (aiResponse.trim()) {
            const aiInsight: InsightInsert = {
              id: uuidv4(),
              endpoint_id: null,
              endpoint_name: null,
              container_id: null,
              container_name: null,
              severity: 'info',
              category: 'ai-analysis',
              title: 'AI Infrastructure Analysis',
              description: aiResponse.trim().slice(0, 2000),
              suggested_action: null,
            };
            await insertInsight(aiInsight);
            broadcastInsight(aiInsight as Insight);
            log.info('AI analysis insight stored (async)');
          }
        } catch (err) {
          log.warn({ err }, 'AI analysis failed (async), using rule-based analysis only');
        }
      })();
    } else if (!config.AI_ANALYSIS_ENABLED) {
      log.debug('AI analysis disabled via AI_ANALYSIS_ENABLED');
    } else {
      log.info('Ollama unavailable, using rule-based analysis only');
    }

    // 7. Collect all insights, cap at MAX_INSIGHTS_PER_CYCLE, batch insert + batch broadcast
    let allInsights = [...anomalyInsights, ...predictiveInsights, ...logAnalysisInsights, ...securityInsights];

    // Cap at MAX_INSIGHTS_PER_CYCLE to prevent unbounded growth
    if (allInsights.length > config.MAX_INSIGHTS_PER_CYCLE) {
      log.warn(
        { total: allInsights.length, cap: config.MAX_INSIGHTS_PER_CYCLE },
        'Insight count exceeds MAX_INSIGHTS_PER_CYCLE, truncating',
      );
      allInsights = allInsights.slice(0, config.MAX_INSIGHTS_PER_CYCLE);
    }

    // Batch insert all insights in a single transaction
    // Returns the set of actually-inserted IDs (deduplication may skip some)
    let insertedIds = new Set<string>();
    try {
      insertedIds = await insertInsights(allInsights);
    } catch (err) {
      log.error({ err }, 'Batch insight insert failed');
    }

    // Batch broadcast via Socket.IO
    if (monitoringNamespace && allInsights.length > 0) {
      // Batch event for modern clients
      monitoringNamespace.to('severity:all').emit('insights:batch', allInsights);
      // Per-severity broadcasts for backward compat
      for (const insight of allInsights) {
        monitoringNamespace.to(`severity:${insight.severity}`).emit('insights:new', insight);
      }
    }

    // Post-insert processing: events, notifications, investigations, remediation
    // Only trigger investigations/incidents for insights that were actually inserted into the DB.
    // Deduplicated insights have no DB row, so referencing their IDs would cause FK violations (#693).
    const suggestedActions: Array<{ actionId: string; actionType: string; insightId: string }> = [];
    for (const insight of allInsights) {
      const wasInserted = insertedIds.has(insight.id);

      // Emit typed event (safe regardless of DB state)
      const insightEventData = {
        insightId: insight.id,
        severity: insight.severity,
        category: insight.category,
        title: insight.title,
        description: insight.description,
        containerId: insight.container_id,
        containerName: insight.container_name,
        endpointId: insight.endpoint_id,
      };
      if (insight.category === 'anomaly') {
        eventBus.emit('anomaly.detected', insightEventData);
      } else {
        eventBus.emit('insight.created', insightEventData);
      }

      // Send notification for critical/warning insights (safe regardless of DB state)
      if (insight.severity === 'critical' || insight.severity === 'warning') {
        notifyInsight(insight as Insight).catch((err) =>
          log.warn({ err, insightId: insight.id }, 'Failed to send notification'),
        );
      }

      // Trigger root cause investigation only for actually-inserted insights (#693)
      if (
        wasInserted && (
          insight.category === 'anomaly' ||
          (insight.category === 'predictive' && insight.severity !== 'info')
        )
      ) {
        triggerInvestigation(insight as Insight).catch((err) => {
          log.warn({ insightId: insight.id, err }, 'Failed to trigger investigation');
        });
      }

      // Attempt to suggest a remediation action for this insight
      const suggestedAction = await suggestAction(insight as Insight);
      if (suggestedAction) {
        suggestedActions.push({
          ...suggestedAction,
          insightId: insight.id,
        });
      }
    }

    // 8. Correlate insights into incidents (alert grouping)
    // Only correlate actually-inserted insights to avoid FK violations (#693)
    const insertedInsightsList = allInsights.filter((ins) => insertedIds.has(ins.id));
    if (insertedInsightsList.length > 0) {
      try {
        const storedInsights = insertedInsightsList.map((ins) => ({
          ...ins,
          is_acknowledged: 0,
          created_at: new Date().toISOString(),
        }));
        const correlation = await correlateInsights(storedInsights as Insight[]);
        if (correlation.incidentsCreated > 0) {
          log.info(
            { incidentsCreated: correlation.incidentsCreated, insightsGrouped: correlation.insightsGrouped },
            'Alert correlation completed',
          );
        }
      } catch (err) {
        log.warn({ err }, 'Alert correlation failed');
      }
    }

    const duration = Date.now() - startTime;
    const currentStats: Record<string, number> = {
      endpoints: endpoints.length,
      containers: allContainers.length,
      totalInsights: allInsights.length,
      anomalies: anomalyInsights.length,
      securityFindings: allFindings.length,
    };

    // Delta-based logging: only log at INFO when counts change significantly (>10%)
    const hasSignificantDelta = !previousCycleStats || Object.keys(currentStats).some((key) => {
      const prev = previousCycleStats![key] ?? 0;
      const curr = currentStats[key];
      if (prev === 0 && curr === 0) return false;
      if (prev === 0) return curr > 0;
      return Math.abs(curr - prev) / prev > 0.1;
    });
    previousCycleStats = { ...currentStats };

    const summaryPayload = {
      duration,
      ...currentStats,
      metricsFromDb: metricsFromDb.length,
      predictiveAlerts: predictiveInsights.length,
      logAnalysisInsights: logAnalysisInsights.length,
      aiAvailable: ollamaAvailable,
      suggestedActions: suggestedActions.length,
    };

    if (hasSignificantDelta) {
      log.info(summaryPayload, 'Monitoring cycle completed');
    } else {
      log.debug(summaryPayload, 'Monitoring cycle completed (no significant changes)');
    }

    if (monitoringNamespace) {
      monitoringNamespace.emit('cycle:complete', {
        duration,
        endpoints: endpoints.length,
        containers: allContainers.length,
        totalInsights: allInsights.length,
      });
    }
  } catch (err) {
    log.error({ err }, 'Monitoring cycle failed');
    throw err;
  } finally {
    try {
      await insertMonitoringCycle(Date.now() - startTime);
    } catch (err) {
      log.warn({ err }, 'Failed to persist monitoring cycle duration');
    }
  }
}
