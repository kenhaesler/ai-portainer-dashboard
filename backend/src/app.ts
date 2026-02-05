import Fastify from 'fastify';
import requestContext from './plugins/request-context.js';
import corsPlugin from './plugins/cors.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import swaggerPlugin from './plugins/swagger.js';
import authPlugin from './plugins/auth.js';
import socketIoPlugin from './plugins/socket-io.js';
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
import { settingsRoutes } from './routes/settings.js';
import { logsRoutes } from './routes/logs.js';
import { imagesRoutes } from './routes/images.js';
import { networksRoutes } from './routes/networks.js';
import { searchRoutes } from './routes/search.js';
import { cacheAdminRoutes } from './routes/cache-admin.js';

export async function buildApp() {
  const isDev = process.env.NODE_ENV !== 'production';
  const app = Fastify({
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
  await app.register(settingsRoutes);
  await app.register(logsRoutes);
  await app.register(imagesRoutes);
  await app.register(networksRoutes);
  await app.register(searchRoutes);
  await app.register(cacheAdminRoutes);

  // Static files (production only)
  await app.register(staticPlugin);

  return app;
}
