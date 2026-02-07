import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import requestContext from './plugins/request-context.js';
import requestTracing from './plugins/request-tracing.js';
import corsPlugin from './plugins/cors.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import swaggerPlugin from './plugins/swagger.js';
import authPlugin from './plugins/auth.js';
import socketIoPlugin from './plugins/socket-io.js';
import compressPlugin from './plugins/compress.js';
import staticPlugin from './plugins/static.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { oidcRoutes } from './routes/oidc.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { endpointsRoutes } from './routes/endpoints.js';
import { containersRoutes } from './routes/containers.js';
import { containerLogsRoutes } from './routes/container-logs.js';
import { stacksRoutes } from './routes/stacks.js';
import { monitoringRoutes } from './routes/monitoring.js';
import { metricsRoutes } from './routes/metrics.js';
import { remediationRoutes } from './routes/remediation.js';
import { tracesRoutes } from './routes/traces.js';
import { backupRoutes } from './routes/backup.js';
import { portainerBackupRoutes } from './routes/portainer-backup.js';
import { settingsRoutes } from './routes/settings.js';
import { logsRoutes } from './routes/logs.js';
import { imagesRoutes } from './routes/images.js';
import { networksRoutes } from './routes/networks.js';
import { investigationRoutes } from './routes/investigations.js';
import { searchRoutes } from './routes/search.js';
import { notificationRoutes } from './routes/notifications.js';
import { cacheAdminRoutes } from './routes/cache-admin.js';
import { pcapRoutes } from './routes/pcap.js';
import { prometheusRoutes } from './routes/prometheus.js';
import { webhookRoutes } from './routes/webhooks.js';
import { reportsRoutes } from './routes/reports.js';
import { userRoutes } from './routes/users.js';
import { incidentsRoutes } from './routes/incidents.js';
import { statusPageRoutes } from './routes/status-page.js';
import { llmRoutes } from './routes/llm.js';
import { llmObservabilityRoutes } from './routes/llm-observability.js';
import { forecastRoutes } from './routes/forecasts.js';
import { correlationRoutes } from './routes/correlations.js';

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
  await app.register(requestContext);
  await app.register(requestTracing);
  await app.register(compressPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await app.register(socketIoPlugin);

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
  await app.register(metricsRoutes);
  await app.register(remediationRoutes);
  await app.register(tracesRoutes);
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
  await app.register(pcapRoutes);
  await app.register(prometheusRoutes);
  await app.register(webhookRoutes);
  await app.register(reportsRoutes);
  await app.register(userRoutes);
  await app.register(incidentsRoutes);
  await app.register(statusPageRoutes);
  await app.register(llmRoutes);
  await app.register(llmObservabilityRoutes);
  await app.register(forecastRoutes);
  await app.register(correlationRoutes);

  // Static files (production only)
  await app.register(staticPlugin);

  return app;
}
