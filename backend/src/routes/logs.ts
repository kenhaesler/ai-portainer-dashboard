import { FastifyInstance } from 'fastify';
import { getConfig } from '../config/index.js';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('logs-route');

interface ElasticsearchConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  indexPattern: string;
  verifySsl: boolean;
}

function getElasticsearchConfig(): ElasticsearchConfig | null {
  const db = getDb();
  const config = getConfig();

  // Try to get settings from database first
  const dbSettings = db.prepare(
    "SELECT key, value FROM settings WHERE key LIKE 'elasticsearch.%'"
  ).all() as Array<{ key: string; value: string }>;

  const settingsMap: Record<string, string> = {};
  dbSettings.forEach((s) => {
    settingsMap[s.key] = s.value;
  });

  // Check if Elasticsearch is enabled in database settings
  const dbEnabled = settingsMap['elasticsearch.enabled'] === 'true';
  const dbEndpoint = settingsMap['elasticsearch.endpoint'];
  const dbApiKey = settingsMap['elasticsearch.api_key'];
  const dbIndexPattern = settingsMap['elasticsearch.index_pattern'] || 'logs-*';
  const dbVerifySsl = settingsMap['elasticsearch.verify_ssl'] !== 'false';

  // If database has valid config, use it
  if (dbEnabled && dbEndpoint) {
    return {
      enabled: true,
      endpoint: dbEndpoint,
      apiKey: dbApiKey || '',
      indexPattern: dbIndexPattern,
      verifySsl: dbVerifySsl,
    };
  }

  // Fall back to environment variables
  if (config.KIBANA_ENDPOINT) {
    return {
      enabled: true,
      endpoint: config.KIBANA_ENDPOINT,
      apiKey: config.KIBANA_API_KEY || '',
      indexPattern: 'logs-*',
      verifySsl: true,
    };
  }

  return null;
}

export async function logsRoutes(fastify: FastifyInstance) {
  // Get Elasticsearch configuration status
  fastify.get('/api/logs/config', {
    schema: {
      tags: ['Logs'],
      summary: 'Get Elasticsearch configuration status',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const esConfig = getElasticsearchConfig();
    return {
      configured: esConfig !== null,
      endpoint: esConfig?.endpoint ? esConfig.endpoint.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : null,
      indexPattern: esConfig?.indexPattern || null,
    };
  });

  // Search logs
  fastify.get('/api/logs/search', {
    schema: {
      tags: ['Logs'],
      summary: 'Search Elasticsearch/Kibana logs',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          hostname: { type: 'string' },
          level: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'number', default: 100 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const esConfig = getElasticsearchConfig();

    if (!esConfig) {
      return reply.code(503).send({
        error: 'Elasticsearch/Kibana not configured',
        message: 'Configure Elasticsearch in Settings or set KIBANA_ENDPOINT environment variable',
      });
    }

    const { query, hostname, level, from, to, limit = 100 } = request.query as {
      query?: string;
      hostname?: string;
      level?: string;
      from?: string;
      to?: string;
      limit?: number;
    };

    try {
      const must: unknown[] = [];
      if (query) must.push({ query_string: { query } });
      if (hostname) must.push({ match: { 'host.name': hostname } });
      if (level) must.push({ match: { 'log.level': level } });

      const range: Record<string, string> = {};
      if (from) range.gte = from;
      if (to) range.lte = to;
      if (Object.keys(range).length > 0) {
        must.push({ range: { '@timestamp': range } });
      }

      const esQuery = {
        size: limit,
        sort: [{ '@timestamp': { order: 'desc' } }],
        query: { bool: { must } },
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (esConfig.apiKey) {
        headers['Authorization'] = `ApiKey ${esConfig.apiKey}`;
      }

      // Construct the search URL with index pattern
      const searchUrl = `${esConfig.endpoint}/${esConfig.indexPattern}/_search`;

      const res = await fetch(searchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(esQuery),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text();
        log.error({ status: res.status, body }, 'Elasticsearch query failed');
        return reply.code(502).send({ error: 'Elasticsearch query failed', details: body });
      }

      const data = await res.json() as any;
      const hits = (data.hits?.hits || []).map((hit: any) => ({
        id: hit._id,
        timestamp: hit._source?.['@timestamp'],
        message: hit._source?.message,
        hostname: hit._source?.host?.name,
        level: hit._source?.log?.level,
        source: hit._source,
      }));

      return { logs: hits, total: data.hits?.total?.value || 0 };
    } catch (err) {
      log.error({ err }, 'Failed to fetch logs');
      return reply.code(502).send({ error: 'Failed to connect to Elasticsearch' });
    }
  });

  // Test Elasticsearch connection
  fastify.post('/api/logs/test-connection', {
    schema: {
      tags: ['Logs'],
      summary: 'Test Elasticsearch connection',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          endpoint: { type: 'string' },
          apiKey: { type: 'string' },
        },
        required: ['endpoint'],
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpoint, apiKey } = request.body as { endpoint: string; apiKey?: string };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `ApiKey ${apiKey}`;
      }

      const res = await fetch(`${endpoint}/_cluster/health`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text();
        return reply.code(400).send({
          success: false,
          error: `Connection failed: ${res.status}`,
          details: body,
        });
      }

      const health = await res.json() as any;
      return {
        success: true,
        cluster_name: health.cluster_name,
        status: health.status,
        number_of_nodes: health.number_of_nodes,
      };
    } catch (err) {
      log.error({ err }, 'Failed to test Elasticsearch connection');
      return reply.code(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  });
}
