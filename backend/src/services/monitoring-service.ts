import { v4 as uuidv4 } from 'uuid';
import type { Namespace } from 'socket.io';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { getEndpoints, getContainers } from './portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from './portainer-cache.js';
import { normalizeEndpoint, normalizeContainer } from './portainer-normalizers.js';
import { scanContainer } from './security-scanner.js';
import { getLatestMetrics } from './metrics-store.js';
import type { MetricInsert } from './metrics-store.js';
import { detectAnomalyAdaptive } from './adaptive-anomaly-detector.js';
import { detectAnomalyIsolationForest } from './isolation-forest-detector.js';
import { insertInsight, getRecentInsights, type InsightInsert } from './insights-store.js';
import { isOllamaAvailable, chatStream, buildInfrastructureContext } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
import { suggestAction } from './remediation-service.js';
import { triggerInvestigation } from './investigation-service.js';
import { getCapacityForecasts } from './capacity-forecaster.js';
import { explainAnomalies } from './anomaly-explainer.js';
import { analyzeLogsForContainers } from './log-analyzer.js';
import { insertMonitoringCycle, insertMonitoringSnapshot } from './monitoring-telemetry-store.js';
import type { Insight } from '../models/monitoring.js';
import type { SecurityFinding } from './security-scanner.js';
import { notifyInsight } from './notification-service.js';
import { emitEvent } from './event-bus.js';
import { correlateInsights } from './incident-correlator.js';

const log = createChildLogger('monitoring-service');

// Per-container+metric cooldown tracker: key = `${containerId}:${metricType}`, value = timestamp (ms)
const anomalyCooldowns = new Map<string, number>();

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
    const containerResults = await Promise.allSettled(
      rawEndpoints.map(async (ep) => {
        const containers = await cachedFetchSWR(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => getContainers(ep.Id),
        );
        return containers.map((c) => ({ raw: c, endpointId: ep.Id, endpointName: ep.Name }));
      }),
    );
    for (const result of containerResults) {
      if (result.status === 'fulfilled') {
        allContainers.push(...result.value);
      } else {
        log.warn({ err: result.reason }, 'Failed to fetch containers for endpoint');
      }
    }

    const normalizedContainers = allContainers.map((c) =>
      normalizeContainer(c.raw, c.endpointId, c.endpointName),
    );

    insertMonitoringSnapshot({
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

    for (const container of runningContainers) {
      try {
        const latest = await getLatestMetrics(container.raw.Id);
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
      } catch (err) {
        log.warn(
          { containerId: container.raw.Id, err },
          'Failed to read latest metrics for container',
        );
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

    // 4. Run anomaly detection on recent metrics
    const config = getConfig();
    const anomalyInsights: InsightInsert[] = [];
    for (const container of runningContainers) {
      const containerName =
        container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

      for (const metricType of ['cpu', 'memory'] as const) {
        const metric = metricsFromDb.find(
          (m) => m.container_id === container.raw.Id && m.metric_type === metricType,
        );
        if (!metric) continue;

        const anomaly = await detectAnomalyAdaptive(container.raw.Id, containerName, metricType, metric.value, config.ANOMALY_DETECTION_METHOD);
        if (anomaly?.is_anomalous) {
          // Cooldown check: skip if this container+metric was recently flagged
          const cooldownKey = `${container.raw.Id}:${metricType}`;
          const cooldownMs = config.ANOMALY_COOLDOWN_MINUTES * 60_000;
          const lastAlerted = anomalyCooldowns.get(cooldownKey);
          if (cooldownMs > 0 && lastAlerted && Date.now() - lastAlerted < cooldownMs) {
            log.debug(
              { containerId: container.raw.Id, metricType, cooldownMinutes: config.ANOMALY_COOLDOWN_MINUTES },
              'Anomaly suppressed by cooldown',
            );
            continue;
          }
          anomalyCooldowns.set(cooldownKey, Date.now());

          anomalyInsights.push({
            id: uuidv4(),
            endpoint_id: container.endpointId,
            endpoint_name: container.endpointName,
            container_id: container.raw.Id,
            container_name: containerName,
            severity: Math.abs(anomaly.z_score) > 4 ? 'critical' : 'warning',
            category: 'anomaly',
            title: `Anomalous ${metricType} usage on "${containerName}"`,
            description:
              `Current ${metricType}: ${anomaly.current_value.toFixed(1)}% ` +
              `(mean: ${anomaly.mean.toFixed(1)}%, z-score: ${anomaly.z_score.toFixed(2)}, ` +
              `method: ${anomaly.method ?? 'zscore'}). ` +
              `This is ${Math.abs(anomaly.z_score).toFixed(1)} standard deviations from the moving average.`,
            suggested_action: metricType === 'memory'
              ? 'Investigate memory usage patterns and check container configuration'
              : 'Investigate CPU usage patterns and check for process anomalies',
          });
        }
      }
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

    // 6. Attempt AI analysis (with LLM fallback)
    const aiInsights: InsightInsert[] = [];

    if (ollamaAvailable) {
      try {
        const recentInsights = getRecentInsights(60);
        const infraContext = buildInfrastructureContext(endpoints, normalizedContainers, recentInsights);
        const userPrompt = getEffectivePrompt('monitoring_analysis');
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
          aiInsights.push({
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
          });
        }
      } catch (err) {
        log.warn({ err }, 'AI analysis failed, using rule-based analysis only');
      }
    } else {
      log.info('Ollama unavailable, using rule-based analysis only');
    }

    // 7. Store all insights and suggest remediation actions
    const allInsights = [...anomalyInsights, ...predictiveInsights, ...logAnalysisInsights, ...securityInsights, ...aiInsights];
    const suggestedActions: Array<{ actionId: string; actionType: string; insightId: string }> = [];

    for (const insight of allInsights) {
      try {
        insertInsight(insight);

        // Broadcast insight in real-time via Socket.IO
        broadcastInsight(insight as Insight);

        // Emit event for webhooks
        const eventType = insight.category === 'anomaly' ? 'anomaly.detected' : 'insight.created';
        emitEvent({
          type: eventType,
          timestamp: new Date().toISOString(),
          data: {
            insightId: insight.id,
            severity: insight.severity,
            category: insight.category,
            title: insight.title,
            description: insight.description,
            containerId: insight.container_id,
            containerName: insight.container_name,
            endpointId: insight.endpoint_id,
          },
        });

        // Send notification for critical/warning insights
        if (insight.severity === 'critical' || insight.severity === 'warning') {
          notifyInsight(insight as Insight).catch((err) =>
            log.warn({ err, insightId: insight.id }, 'Failed to send notification'),
          );
        }

        // Trigger root cause investigation for anomaly and non-info predictive insights
        if (
          insight.category === 'anomaly' ||
          (insight.category === 'predictive' && insight.severity !== 'info')
        ) {
          triggerInvestigation(insight as Insight).catch((err) => {
            log.warn({ insightId: insight.id, err }, 'Failed to trigger investigation');
          });
        }

        // Attempt to suggest a remediation action for this insight
        const suggestedAction = suggestAction(insight as Insight);
        if (suggestedAction) {
          suggestedActions.push({
            ...suggestedAction,
            insightId: insight.id,
          });
        }
      } catch (err) {
        log.warn({ insightId: insight.id, err }, 'Failed to insert insight');
      }
    }

    // 8. Correlate insights into incidents (alert grouping)
    if (allInsights.length > 0) {
      try {
        const storedInsights = allInsights.map((ins) => ({
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
    log.info(
      {
        duration,
        endpoints: endpoints.length,
        containers: allContainers.length,
        metricsFromDb: metricsFromDb.length,
        securityFindings: allFindings.length,
        anomalies: anomalyInsights.length,
        predictiveAlerts: predictiveInsights.length,
        logAnalysisInsights: logAnalysisInsights.length,
        aiAvailable: ollamaAvailable,
        totalInsights: allInsights.length,
        suggestedActions: suggestedActions.length,
      },
      'Monitoring cycle completed',
    );

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
      insertMonitoringCycle(Date.now() - startTime);
    } catch (err) {
      log.warn({ err }, 'Failed to persist monitoring cycle duration');
    }
  }
}
