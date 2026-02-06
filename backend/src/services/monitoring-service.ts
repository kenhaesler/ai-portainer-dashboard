import { v4 as uuidv4 } from 'uuid';
import type { Namespace } from 'socket.io';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { getEndpoints, getContainers } from './portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from './portainer-normalizers.js';
import { scanContainer } from './security-scanner.js';
import { collectMetrics } from './metrics-collector.js';
import { insertMetrics, type MetricInsert } from './metrics-store.js';
import { detectAnomaly } from './anomaly-detector.js';
import { insertInsight, getRecentInsights, type InsightInsert } from './insights-store.js';
import { isOllamaAvailable, chatStream, buildInfrastructureContext } from './llm-client.js';
import { suggestAction } from './remediation-service.js';
import { triggerInvestigation } from './investigation-service.js';
import { insertMonitoringCycle, insertMonitoringSnapshot } from './monitoring-telemetry-store.js';
import type { Insight } from '../models/monitoring.js';
import type { SecurityFinding } from './security-scanner.js';
import { notifyInsight } from './notification-service.js';

const log = createChildLogger('monitoring-service');

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
    // 1. Collect snapshot of all endpoints and containers
    const rawEndpoints = await getEndpoints();
    const endpoints = rawEndpoints.map(normalizeEndpoint);

    const allContainers: Array<{
      raw: Awaited<ReturnType<typeof getContainers>>[number];
      endpointId: number;
      endpointName: string;
    }> = [];

    for (const ep of rawEndpoints) {
      try {
        const containers = await getContainers(ep.Id);
        for (const c of containers) {
          allContainers.push({ raw: c, endpointId: ep.Id, endpointName: ep.Name });
        }
      } catch (err) {
        log.warn({ endpointId: ep.Id, err }, 'Failed to fetch containers for endpoint');
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

    // 2. Collect metrics for running containers
    const metricsToInsert: MetricInsert[] = [];
    const runningContainers = allContainers.filter((c) => c.raw.State === 'running');

    for (const container of runningContainers) {
      try {
        const stats = await collectMetrics(container.endpointId, container.raw.Id);
        const containerName =
          container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

        metricsToInsert.push(
          {
            endpoint_id: container.endpointId,
            container_id: container.raw.Id,
            container_name: containerName,
            metric_type: 'cpu',
            value: stats.cpu,
          },
          {
            endpoint_id: container.endpointId,
            container_id: container.raw.Id,
            container_name: containerName,
            metric_type: 'memory',
            value: stats.memory,
          },
          {
            endpoint_id: container.endpointId,
            container_id: container.raw.Id,
            container_name: containerName,
            metric_type: 'memory_bytes',
            value: stats.memoryBytes,
          },
        );
      } catch (err) {
        log.warn(
          { containerId: container.raw.Id, err },
          'Failed to collect metrics for container',
        );
      }
    }

    if (metricsToInsert.length > 0) {
      insertMetrics(metricsToInsert);
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
    const anomalyInsights: InsightInsert[] = [];
    for (const container of runningContainers) {
      const containerName =
        container.raw.Names?.[0]?.replace(/^\//, '') || container.raw.Id.slice(0, 12);

      for (const metricType of ['cpu', 'memory'] as const) {
        const metric = metricsToInsert.find(
          (m) => m.container_id === container.raw.Id && m.metric_type === metricType,
        );
        if (!metric) continue;

        const anomaly = detectAnomaly(container.raw.Id, containerName, metricType, metric.value);
        if (anomaly?.is_anomalous) {
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
              `(mean: ${anomaly.mean.toFixed(1)}%, z-score: ${anomaly.z_score.toFixed(2)}). ` +
              `This is ${Math.abs(anomaly.z_score).toFixed(1)} standard deviations from the moving average.`,
            suggested_action: metricType === 'memory'
              ? 'Check for memory leaks or increase memory limit'
              : 'Check for runaway processes or increase CPU allocation',
          });
        }
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
    const ollamaAvailable = await isOllamaAvailable();

    if (ollamaAvailable) {
      try {
        const recentInsights = getRecentInsights(60);
        const context = buildInfrastructureContext(endpoints, normalizedContainers, recentInsights);

        const analysisPrompt =
          'Analyze the current infrastructure state. Identify the top 3 most important ' +
          'issues or recommendations. Be specific and actionable. Format each as a brief title and description.';

        let aiResponse = '';
        await chatStream(
          [{ role: 'user', content: analysisPrompt }],
          context,
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
    const allInsights = [...anomalyInsights, ...securityInsights, ...aiInsights];
    const suggestedActions: Array<{ actionId: string; actionType: string; insightId: string }> = [];

    for (const insight of allInsights) {
      try {
        insertInsight(insight);

        // Broadcast insight in real-time via Socket.IO
        broadcastInsight(insight as Insight);

        // Send notification for critical/warning insights
        if (insight.severity === 'critical' || insight.severity === 'warning') {
          notifyInsight(insight as Insight).catch((err) =>
            log.warn({ err, insightId: insight.id }, 'Failed to send notification'),
          );
        }

        // Trigger root cause investigation for anomaly insights
        if (insight.category === 'anomaly') {
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

    const duration = Date.now() - startTime;
    log.info(
      {
        duration,
        endpoints: endpoints.length,
        containers: allContainers.length,
        metricsCollected: metricsToInsert.length,
        securityFindings: allFindings.length,
        anomalies: anomalyInsights.length,
        aiAvailable: ollamaAvailable,
        totalInsights: allInsights.length,
        suggestedActions: suggestedActions.length,
      },
      'Monitoring cycle completed',
    );
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
