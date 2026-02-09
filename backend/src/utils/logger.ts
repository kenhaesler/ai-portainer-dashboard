import pino from 'pino';
import {
  createElasticsearchTransport,
  type ElasticsearchTransportOptions,
} from './pino-elasticsearch-transport.js';

const isDev = process.env.NODE_ENV !== 'production';

function readLogShippingConfig(): ElasticsearchTransportOptions | null {
  const enabled =
    process.env.LOG_SHIPPING_ENABLED === 'true' || process.env.LOG_SHIPPING_ENABLED === '1';
  const endpoint = process.env.LOG_SHIPPING_ENDPOINT;

  if (!enabled || !endpoint) return null;

  return {
    endpoint,
    indexPrefix: process.env.LOG_SHIPPING_INDEX_PREFIX || 'dashboard-logs',
    username: process.env.LOG_SHIPPING_USERNAME,
    password: process.env.LOG_SHIPPING_PASSWORD,
    batchSize: Math.max(1, Number(process.env.LOG_SHIPPING_BATCH_SIZE) || 100),
    flushIntervalMs: Math.max(500, Number(process.env.LOG_SHIPPING_FLUSH_INTERVAL_MS) || 5000),
  };
}

function createLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL || 'info';
  const logShippingConfig = readLogShippingConfig();

  // In development, use pino-pretty transport for nice console output.
  // pino-pretty runs in a worker thread and is incompatible with multistream,
  // so log shipping is not supported in dev mode.
  if (isDev) {
    if (logShippingConfig) {
      console.warn(
        '[logger] LOG_SHIPPING_ENABLED is set but ignored in development mode. ' +
          'Set NODE_ENV=production to enable Elasticsearch log shipping.',
      );
    }
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // Production: use multistream for stdout + optional Elasticsearch transport
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];

  if (logShippingConfig) {
    const esStream = createElasticsearchTransport(logShippingConfig);
    streams.push({ stream: esStream });
  }

  return pino({ level }, pino.multistream(streams));
}

export const logger = createLogger();

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
