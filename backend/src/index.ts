import { buildApp } from './app.js';
import { getConfig } from './config/index.js';
import { getDb, closeDb } from './db/sqlite.js';
import { createChildLogger } from './utils/logger.js';
import { setupLlmNamespace } from './sockets/llm-chat.js';
import { setupMonitoringNamespace } from './sockets/monitoring.js';
import { setupRemediationNamespace } from './sockets/remediation.js';
import { startScheduler, stopScheduler } from './scheduler/setup.js';
import { setMonitoringNamespace } from './services/monitoring-service.js';
import { setInvestigationNamespace } from './services/investigation-service.js';
import { ensureModel } from './services/llm-client.js';

const log = createChildLogger('server');

async function main() {
  const config = getConfig();
  const app = await buildApp();

  // Initialize database (runs migrations)
  getDb();

  // Setup Socket.IO namespaces
  setupLlmNamespace(app.ioNamespaces.llm);
  setupMonitoringNamespace(app.ioNamespaces.monitoring);
  setupRemediationNamespace(app.ioNamespaces.remediation);

  // Register monitoring namespace for real-time insight broadcasting
  setMonitoringNamespace(app.ioNamespaces.monitoring);
  setInvestigationNamespace(app.ioNamespaces.monitoring);

  // Start background schedulers
  startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received shutdown signal');
    try {
      stopScheduler();
      await app.close();
      closeDb();
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
  } catch (err) {
    log.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
