/**
 * Dependency injection wiring — the only place that imports from all domain packages
 * and wires their concrete implementations to the contracts / interfaces.
 */
import {
  createMonitoringService,
  isLlmAvailable,
  chatStream,
  buildInfrastructureContext,
  getEffectivePrompt,
  runTraceAnomalyCycle,
} from '@dashboard/ai';
import type { MonitoringDeps, ComputeRedFn } from '@dashboard/ai';
import {
  getLatestMetrics,
  getMetrics,
  getLatestMetricsBatch,
  getMovingAverage,
  getMovingAverageByHourOfDay,
  getMetricWindow,
  getMetricWindowByHourOfDay,
  getCapacityForecasts,
  generateForecast,
  findSimilarInsights,
  computeRed,
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
    isAvailable: isLlmAvailable,
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
    getMovingAverageByHourOfDay,
    getMetricWindow,
    getMetricWindowByHourOfDay,
    getCapacityForecasts,
    generateForecast,
    findSimilarInsights,
  };
}

/** Build the monitoring service with all cross-domain deps wired via DI. */
export function buildMonitoringService(metricsAdapter?: MetricsInterface) {
  // The ai-intelligence package is forbidden from importing observability
  // directly. The trace-anomaly cycle therefore consumes computeRed via DI
  // here; the cast narrows the surface to what the cycle actually uses.
  const traceComputeRed: ComputeRedFn = computeRed as unknown as ComputeRedFn;
  const monitoringDeps: MonitoringDeps = {
    scanner: { scanContainer },
    metrics: metricsAdapter ?? buildMetricsAdapter(),
    notifications: { notifyInsight },
    operations: { suggestAction },
    runTraceAnomalyCycle: () => runTraceAnomalyCycle({ computeRed: traceComputeRed }),
  };
  return createMonitoringService(monitoringDeps);
}
