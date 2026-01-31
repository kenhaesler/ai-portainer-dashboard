import { buildApp } from './app.js';
import { getConfig } from './config/index.js';
import { getDb, closeDb } from './db/sqlite.js';
import { createChildLogger } from './utils/logger.js';
import { setupLlmNamespace } from './sockets/llm-chat.js';
import { setupMonitoringNamespace } from './sockets/monitoring.js';
import { setupRemediationNamespace } from './sockets/remediation.js';

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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received shutdown signal');
    try {
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
  } catch (err) {
    log.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
