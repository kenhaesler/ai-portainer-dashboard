import { FastifyInstance } from 'fastify';
import { Agent } from 'undici';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { LogsSearchQuerySchema, LogsTestBodySchema } from '@dashboard/core/models/api-schemas.js';
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts infrastructure interface
import { getElasticsearchConfig } from '../../infrastructure/index.js';

const log = createChildLogger('logs-route');

const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

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
    const esConfig = await getElasticsearchConfig();
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
      querystring: LogsSearchQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const esConfig = await getElasticsearchConfig();

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
        dispatcher: esConfig.verifySsl ? undefined : insecureDispatcher,
      } as RequestInit);
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
      body: LogsTestBodySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpoint, apiKey, verifySsl = true } = request.body as { endpoint: string; apiKey?: string; verifySsl?: boolean };

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
        dispatcher: verifySsl ? undefined : insecureDispatcher,
      } as RequestInit);
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
