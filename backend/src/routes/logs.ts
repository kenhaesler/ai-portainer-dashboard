import { FastifyInstance } from 'fastify';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('logs-route');

export async function logsRoutes(fastify: FastifyInstance) {
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
    const config = getConfig();
    if (!config.KIBANA_ENDPOINT) {
      return reply.code(503).send({
        error: 'Elasticsearch/Kibana not configured',
        message: 'Set KIBANA_ENDPOINT and KIBANA_API_KEY environment variables',
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
      if (config.KIBANA_API_KEY) {
        headers['Authorization'] = `ApiKey ${config.KIBANA_API_KEY}`;
      }

      const res = await fetch(`${config.KIBANA_ENDPOINT}/_search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(esQuery),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text();
        log.error({ status: res.status, body }, 'Elasticsearch query failed');
        return reply.code(502).send({ error: 'Elasticsearch query failed' });
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
}
