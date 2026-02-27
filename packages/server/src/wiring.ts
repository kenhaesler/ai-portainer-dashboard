/**
 * Dependency injection wiring — the only place that imports from all domain packages
 * and wires their concrete implementations to the contracts / interfaces.
 */
import {
  createMonitoringService,
  isOllamaAvailable,
  chatStream,
  buildInfrastructureContext,
  getEffectivePrompt,
} from '@dashboard/ai';
import type { MonitoringDeps } from '@dashboard/ai';
import {
  getLatestMetrics,
  getMetrics,
  getLatestMetricsBatch,
  getMovingAverage,
  getCapacityForecasts,
  generateForecast,
  findSimilarInsights,
} from '@dashboard/observability';
import { scanContainer } from '@dashboard/security';
import { notifyInsight, suggestAction } from '@dashboard/operations';
import {
  getContainerLogsWithRetry,
  isEdgeAsync,
  getEdgeAsyncContainerLogs,
} from '@dashboard/infrastructure';
import type { InfrastructureLogsInterface, LLMInterface, MetricsInterface } from '@dashboard/contracts';

/** Shared infrastructure logs adapter (injected into ai-intelligence's llm-tools). */
export const infraLogsAdapter: InfrastructureLogsInterface = {
  getContainerLogsWithRetry,
  isEdgeAsync,
  getEdgeAsyncContainerLogs,
};

/** LLM adapter — wires ai-intelligence services to the LLMInterface contract. */
export function buildLlmAdapter(): LLMInterface {
  return {
    isAvailable: isOllamaAvailable,
    chatStream,
    buildInfrastructureContext,
    getEffectivePrompt,
  };
}

/** Metrics adapter — wires observability services to the MetricsInterface contract. */
export function buildMetricsAdapter(): MetricsInterface {
  return {
    getLatestMetrics,
    getMetrics: async (_endpointId, containerId, metricType, from, to) =>
      getMetrics(containerId, metricType, from.toISOString(), to.toISOString()),
    detectAnomalies: async () => [],  // stub — not needed in Phase 3
    getLatestMetricsBatch,
    getMovingAverage,
    getCapacityForecasts,
    generateForecast,
    findSimilarInsights,
  };
}

/** Build the monitoring service with all cross-domain deps wired via DI. */
export function buildMonitoringService() {
  const monitoringDeps: MonitoringDeps = {
    scanner: { scanContainer },
    metrics: buildMetricsAdapter(),
    notifications: { notifyInsight },
    operations: { suggestAction },
  };
  return createMonitoringService(monitoringDeps);
}
