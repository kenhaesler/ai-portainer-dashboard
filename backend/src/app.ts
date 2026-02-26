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
} from './modules/operations/index.js';
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
} from './modules/ai-intelligence/index.js';
import { infrastructureRoutes } from '@dashboard/infrastructure/routes/index.js';
import { securityRoutes } from '@dashboard/security/routes/index.js';
import { observabilityRoutes } from '@dashboard/observability/routes/index.js';
import { isOllamaAvailable, chatStream, buildInfrastructureContext } from './modules/ai-intelligence/services/llm-client.js';
import { getEffectivePrompt } from './modules/ai-intelligence/services/prompt-store.js';
import { getPromptGuardNearMissTotal } from './modules/ai-intelligence/services/prompt-guard.js';
import type { LLMInterface } from '@dashboard/contracts';

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

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(oidcRoutes);
  await app.register(dashboardRoutes);
  await app.register(endpointsRoutes);
  await app.register(containersRoutes);
  await app.register(containerLogsRoutes);
  await app.register(stacksRoutes);
  await app.register(monitoringRoutes);
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
  await app.register(correlationRoutes);
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
