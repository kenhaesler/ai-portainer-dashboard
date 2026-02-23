// Shim — re-exports from core/utils (will be removed in Phase H)
export {
  createElasticsearchTransport,
  formatIndexDate,
  buildBulkBody,
  sendBulk,
} from '../core/utils/pino-elasticsearch-transport.js';
export type {
  ElasticsearchTransportOptions,
  ElasticsearchTransportStream,
} from '../core/utils/pino-elasticsearch-transport.js';
