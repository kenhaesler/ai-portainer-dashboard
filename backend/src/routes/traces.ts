import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { TracesQuerySchema, TraceIdParamsSchema } from '../models/api-schemas.js';

export async function tracesRoutes(fastify: FastifyInstance) {
  function buildSpanConditions(
    filters: {
      from?: string;
      to?: string;
      serviceName?: string;
      status?: string;
      source?: string;
      minDuration?: number;
    },
    alias: string,
  ) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.from) { conditions.push(`${alias}.start_time >= ?`); params.push(filters.from); }
    if (filters.to) { conditions.push(`${alias}.start_time <= ?`); params.push(filters.to); }
    if (filters.serviceName) { conditions.push(`${alias}.service_name = ?`); params.push(filters.serviceName); }
    if (filters.status) { conditions.push(`${alias}.status = ?`); params.push(filters.status); }
    if (filters.source) { conditions.push(`${alias}.trace_source = ?`); params.push(filters.source); }
    if (filters.minDuration !== undefined) { conditions.push(`${alias}.duration_ms >= ?`); params.push(filters.minDuration); }

    return { conditions, params };
  }

  // List traces
  fastify.get('/api/traces', {
    schema: {
      tags: ['Traces'],
      summary: 'List traces',
      security: [{ bearerAuth: [] }],
      querystring: TracesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { from, to, serviceName, status, source, minDuration, limit = 50 } = request.query as {
      from?: string;
      to?: string;
      serviceName?: string;
      status?: string;
      source?: string;
      minDuration?: number;
      limit?: number;
    };

    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (from) { conditions.push('s.start_time >= ?'); params.push(from); }
    if (to) { conditions.push('s.start_time <= ?'); params.push(to); }
    if (serviceName) { conditions.push('s.service_name = ?'); params.push(serviceName); }
    if (status) { conditions.push('s.status = ?'); params.push(status); }
    if (source) { conditions.push('s.trace_source = ?'); params.push(source); }
    if (minDuration) { conditions.push('s.duration_ms >= ?'); params.push(minDuration); }

    // Only get root spans (no parent)
    conditions.push('s.parent_span_id IS NULL');

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const traces = db.prepare(`
      SELECT s.trace_id, s.name as root_span, s.duration_ms, s.status, s.service_name,
             s.start_time, s.trace_source,
             (SELECT COUNT(*) FROM spans s2 WHERE s2.trace_id = s.trace_id) as span_count
      FROM spans s
      ${where}
      ORDER BY s.start_time DESC
      LIMIT ?
    `).all(...params, limit);

    return { traces };
  });

  // Get single trace with all spans
  fastify.get('/api/traces/:traceId', {
    schema: {
      tags: ['Traces'],
      summary: 'Get full trace with all spans',
      security: [{ bearerAuth: [] }],
      params: TraceIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { traceId } = request.params as { traceId: string };
    const db = getDb();

    const spans = db.prepare(
      'SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC'
    ).all(traceId);

    return { traceId, spans };
  });

  // Service map
  fastify.get('/api/traces/service-map', {
    schema: {
      tags: ['Traces'],
      summary: 'Get service dependency map',
      security: [{ bearerAuth: [] }],
      querystring: TracesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { from, to, serviceName, status, source, minDuration } = request.query as {
      from?: string;
      to?: string;
      serviceName?: string;
      status?: string;
      source?: string;
      minDuration?: number;
    };

    const db = getDb();
    const { conditions, params } = buildSpanConditions(
      { from, to, serviceName, status, source, minDuration },
      's',
    );
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Nodes: unique services with stats
    const nodes = db.prepare(`
      SELECT service_name as id, service_name as name,
             COUNT(*) as callCount,
             AVG(duration_ms) as avgDuration,
             CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as errorRate
      FROM spans s
      ${where}
      GROUP BY service_name
    `).all(...params);

    const childConditions = conditions.map((c) => c.replaceAll('s.', 'c.'));
    const childWhere = childConditions.length > 0 ? `WHERE ${childConditions.join(' AND ')}` : '';

    // Edges: parent→child relationships
    const edges = db.prepare(`
      SELECT p.service_name as source, c.service_name as target,
             COUNT(*) as callCount,
             AVG(c.duration_ms) as avgDuration
      FROM spans c
      JOIN spans p ON c.parent_span_id = p.id
      ${childWhere}${childWhere ? ' AND ' : ' WHERE '}p.service_name != c.service_name
      GROUP BY p.service_name, c.service_name
    `).all(...params);

    return { nodes, edges };
  });

  // Summary stats
  fastify.get('/api/traces/summary', {
    schema: {
      tags: ['Traces'],
      summary: 'Get trace summary statistics',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { from, to } = request.query as { from?: string; to?: string };
    const db = getDb();
    const conditions: string[] = ['parent_span_id IS NULL'];
    const params: unknown[] = [];

    if (from) { conditions.push('start_time >= ?'); params.push(from); }
    if (to) { conditions.push('start_time <= ?'); params.push(to); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const summary = db.prepare(`
      SELECT
        COUNT(DISTINCT trace_id) as totalTraces,
        AVG(duration_ms) as avgDuration,
        CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as errorRate,
        COUNT(DISTINCT service_name) as services
      FROM spans
      ${where}
    `).get(...params) as { totalTraces: number; avgDuration: number | null; errorRate: number | null };

    const serviceCount = db.prepare(`
      SELECT COUNT(DISTINCT service_name) as services
      FROM spans
      ${from || to ? `WHERE ${[
        from ? 'start_time >= ?' : '',
        to ? 'start_time <= ?' : '',
      ].filter(Boolean).join(' AND ')}` : ''}
    `).get(...[
      ...(from ? [from] : []),
      ...(to ? [to] : []),
    ]) as { services: number };

    return {
      totalTraces: summary.totalTraces ?? 0,
      avgDuration: Math.round((summary.avgDuration ?? 0) * 100) / 100,
      errorRate: Math.round((summary.errorRate ?? 0) * 10000) / 10000,
      services: serviceCount.services ?? 0,
    };
  });
}
