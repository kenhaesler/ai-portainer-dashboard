import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import requestTracing from '@dashboard/core/plugins/request-tracing.js';
import corsPlugin from '@dashboard/core/plugins/cors.js';
import rateLimitPlugin from '@dashboard/core/plugins/rate-limit.js';
import swaggerPlugin from '@dashboard/core/plugins/swagger.js';
import authPlugin from '@dashboard/core/plugins/auth.js';
import socketIoPlugin from '@dashboard/core/plugins/socket-io.js';
import compressPlugin from '@dashboard/core/plugins/compress.js';
import securityHeadersPlugin from '@dashboard/core/plugins/security-headers.js';
import cacheControlPlugin from '@dashboard/core/plugins/cache-control.js';
import staticPlugin from '@dashboard/core/plugins/static.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { oidcRoutes } from './routes/oidc.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { endpointsRoutes } from './routes/endpoints.js';
import { containersRoutes } from './routes/containers.js';
import { containerLogsRoutes } from './routes/container-logs.js';
import { stacksRoutes } from './routes/stacks.js';

import { settingsRoutes } from './routes/settings.js';
import { imagesRoutes } from './routes/images.js';
import { networksRoutes } from './routes/networks.js';

import { searchRoutes } from './routes/search.js';
import { cacheAdminRoutes } from './routes/cache-admin.js';
import { userRoutes } from './routes/users.js';
import {
  remediationRoutes,
  backupRoutes,
  portainerBackupRoutes,
  logsRoutes,
  notificationRoutes,
  webhookRoutes,
  initRemediationDeps,
  suggestAction,
  notifyInsight,
} from '@dashboard/operations';
import {
  monitoringRoutes,
  investigationRoutes,
  incidentsRoutes,
  correlationRoutes,
  llmRoutes,
  llmObservabilityRoutes,
  llmFeedbackRoutes,
  mcpRoutes,
  promptProfileRoutes,
  isOllamaAvailable,
  chatStream,
  buildInfrastructureContext,
  getEffectivePrompt,
  getPromptGuardNearMissTotal,
  createMonitoringService,
  initInvestigationDeps,
} from '@dashboard/ai';
import type { MonitoringDeps } from '@dashboard/ai';
import { infrastructureRoutes } from '@dashboard/infrastructure/routes/index.js';
import { securityRoutes } from '@dashboard/security/routes/index.js';
import { observabilityRoutes } from '@dashboard/observability/routes/index.js';
import type { LLMInterface, MetricsInterface } from '@dashboard/contracts';
import {
  getLatestMetrics,
  getMetrics,
  getLatestMetricsBatch,
  getMovingAverage,
  getCapacityForecasts,
  generateForecast,
  findSimilarInsights,
} from '@dashboard/observability';
import {
  scanContainer,
  getSecurityAudit,
  getSecurityAuditIgnoreList,
  setSecurityAuditIgnoreList,
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
  SECURITY_AUDIT_IGNORE_KEY,
} from '@dashboard/security';
import {
  detectCorrelatedAnomalies,
  findCorrelatedContainers,
  isUndefinedTableError,
} from '@dashboard/observability';
import {
  getContainerLogsWithRetry,
  isEdgeAsync,
  getEdgeAsyncContainerLogs,
} from '@dashboard/infrastructure';
import type { InfrastructureLogsInterface } from '@dashboard/contracts';

function getHttp2Options(): { http2: true; https: { key: Buffer; cert: Buffer; allowHTTP1: true } } | Record<string, never> {
  const enabled = process.env.HTTP2_ENABLED === 'true';
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;

  if (enabled && certPath && keyPath) {
    return {
      http2: true,
      https: {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
        allowHTTP1: true,
      },
    };
  }
  return {};
}

/** Shared infrastructure logs adapter (injected into ai-intelligence's llm-tools). */
export const infraLogsAdapter: InfrastructureLogsInterface = {
  getContainerLogsWithRetry,
  isEdgeAsync,
  getEdgeAsyncContainerLogs,
};

export async function buildApp() {
  const isDev = process.env.NODE_ENV !== 'production';
  const app = Fastify({
    ...getHttp2Options(),
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(isDev && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Core plugins
  await app.register(requestTracing);
  await app.register(compressPlugin);
  await app.register(securityHeadersPlugin);
  await app.register(cacheControlPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await app.register(socketIoPlugin);

  // LLM adapter — wires ai-intelligence services to the LLMInterface contract
  // Defined once and reused for all packages that need LLM access (security, observability, etc.)
  const llmAdapter: LLMInterface = {
    isAvailable: isOllamaAvailable,
    chatStream,
    buildInfrastructureContext,
    getEffectivePrompt,
  };

  // Metrics adapter — wires observability services to the MetricsInterface contract
  const metricsAdapter: MetricsInterface = {
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

  initRemediationDeps(llmAdapter, metricsAdapter);

  // Initialize investigation service deps (breaks ai → observability import)
  // Note: InvestigationMetricsDeps.getMetrics uses 4-param string signature (no endpointId, ISO strings)
  initInvestigationDeps({
    getMetrics: (containerId, metricType, from, to) => getMetrics(containerId, metricType, from, to),
    getMovingAverage,
    generateForecast,
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(oidcRoutes);
  await app.register(dashboardRoutes);
  await app.register(endpointsRoutes);
  await app.register(containersRoutes);
  await app.register(containerLogsRoutes);
  await app.register(stacksRoutes);
  await app.register(monitoringRoutes, {
    getSecurityAudit,
    getSecurityAuditIgnoreList,
    setSecurityAuditIgnoreList,
    defaultSecurityAuditIgnorePatterns: DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
    securityAuditIgnoreKey: SECURITY_AUDIT_IGNORE_KEY,
  });
  await app.register(remediationRoutes);
  await app.register(backupRoutes);
  await app.register(portainerBackupRoutes);
  await app.register(settingsRoutes);
  await app.register(logsRoutes);
  await app.register(imagesRoutes);
  await app.register(networksRoutes);
  await app.register(investigationRoutes);
  await app.register(searchRoutes);
  await app.register(notificationRoutes);
  await app.register(cacheAdminRoutes);
  await app.register(webhookRoutes);
  await app.register(userRoutes);
  await app.register(incidentsRoutes);
  await app.register(llmRoutes);
  await app.register(llmObservabilityRoutes);
  await app.register(correlationRoutes, {
    detectCorrelatedAnomalies,
    findCorrelatedContainers,
    isUndefinedTableError,
  });
  await app.register(mcpRoutes);
  await app.register(promptProfileRoutes);
  await app.register(llmFeedbackRoutes);
  await app.register(infrastructureRoutes);
  await app.register(securityRoutes, { llm: llmAdapter });
  await app.register(observabilityRoutes, { llm: llmAdapter, getPromptGuardNearMissTotal });

  // Static files (production only)
  await app.register(staticPlugin);

  return app;
}

/** Build the monitoring service with all cross-domain deps wired via DI. */
export function buildMonitoringService() {
  const monitoringDeps: MonitoringDeps = {
    scanner: { scanContainer },
    metrics: {
      getLatestMetrics,
      getMetrics: async (_endpointId, containerId, metricType, from, to) =>
        getMetrics(containerId, metricType, from.toISOString(), to.toISOString()),
      detectAnomalies: async () => [],
      getLatestMetricsBatch,
      getMovingAverage,
      getCapacityForecasts,
      generateForecast,
      findSimilarInsights,
    },
    notifications: { notifyInsight },
    operations: { suggestAction },
  };
  return createMonitoringService(monitoringDeps);
}
