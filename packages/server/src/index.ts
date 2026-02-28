import { buildApp } from './app.js';
import { buildMonitoringService, infraLogsAdapter } from './wiring.js';
import { setupSockets } from './socket-setup.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { getConfig } from '@dashboard/core/config/index.js';
import { getMetricsDb, closeMetricsDb, closeReportsDb } from '@dashboard/core/db/timescale.js';
import { getAppDb, closeAppDb } from '@dashboard/core/db/postgres.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { ensureModel, autoConnectAll, disconnectAll } from '@dashboard/ai';

const log = createChildLogger('server');

// Safety net: log unhandled rejections instead of crashing the process
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Unhandled promise rejection (process kept alive)');
});

async function main() {
  const config = getConfig();
  const { app, metricsAdapter } = await buildApp();

  // Initialize databases (runs migrations)
  await getAppDb();
  await getMetricsDb();

  // Build monitoring service with DI wiring (reuse the shared metricsAdapter from app.ts)
  const monitoringService = buildMonitoringService(metricsAdapter);

  // Setup Socket.IO namespaces (pass infraLogsAdapter for container log tool execution)
  setupSockets(app.ioNamespaces, infraLogsAdapter);

  // Start background schedulers (pass monitoring cycle from the DI-wired service)
  await startScheduler(monitoringService.runMonitoringCycle);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received shutdown signal');
    try {
      stopScheduler();
      await disconnectAll();
      await app.close();
      await closeAppDb();
      await closeReportsDb();
      await closeMetricsDb();
      log.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    log.info({ port: config.PORT }, 'Server started');
    log.info('Socket.IO namespaces: /llm, /monitoring, /remediation');

    // Pull configured Ollama model in the background (non-blocking)
    ensureModel().catch(() => {});

    // Auto-connect enabled MCP servers in the background (non-blocking)
    autoConnectAll().catch(() => {});
  } catch (err) {
    log.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
