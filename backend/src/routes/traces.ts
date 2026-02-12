import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { TracesQuerySchema, TraceIdParamsSchema } from '../models/api-schemas.js';

type TraceFilters = {
  from?: string;
  to?: string;
  serviceName?: string;
  status?: string;
  source?: string;
  minDuration?: number;
  httpMethod?: string;
  httpRoute?: string;
  httpRouteMatch?: 'exact' | 'contains';
  httpStatusCode?: number;
  serviceNamespace?: string;
  serviceNamespaceMatch?: 'exact' | 'contains';
  serviceInstanceId?: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  containerId?: string;
  containerName?: string;
  containerNameMatch?: 'exact' | 'contains';
  k8sNamespace?: string;
  k8sNamespaceMatch?: 'exact' | 'contains';
  k8sPodName?: string;
  k8sContainerName?: string;
  serverAddress?: string;
  serverPort?: number;
  clientAddress?: string;
};

function pushTextCondition(
  conditions: string[],
  params: unknown[],
  column: string,
  value: string | undefined,
  matchMode: 'exact' | 'contains' | undefined,
) {
  if (!value) return;
  if (matchMode === 'contains') {
    conditions.push(`${column} LIKE ?`);
    params.push(`%${value}%`);
    return;
  }
  conditions.push(`${column} = ?`);
  params.push(value);
}

function buildSpanConditions(filters: TraceFilters, alias: string) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.from) { conditions.push(`${alias}.start_time >= ?`); params.push(filters.from); }
  if (filters.to) { conditions.push(`${alias}.start_time <= ?`); params.push(filters.to); }
  if (filters.serviceName) { conditions.push(`${alias}.service_name = ?`); params.push(filters.serviceName); }
  if (filters.status) { conditions.push(`${alias}.status = ?`); params.push(filters.status); }
  if (filters.source) { conditions.push(`${alias}.trace_source = ?`); params.push(filters.source); }
  if (filters.minDuration !== undefined) { conditions.push(`${alias}.duration_ms >= ?`); params.push(filters.minDuration); }
  if (filters.httpMethod) { conditions.push(`${alias}.http_method = ?`); params.push(filters.httpMethod); }
  pushTextCondition(conditions, params, `${alias}.http_route`, filters.httpRoute, filters.httpRouteMatch);
  if (filters.httpStatusCode !== undefined) { conditions.push(`${alias}.http_status_code = ?`); params.push(filters.httpStatusCode); }
  pushTextCondition(conditions, params, `${alias}.service_namespace`, filters.serviceNamespace, filters.serviceNamespaceMatch);
  if (filters.serviceInstanceId) { conditions.push(`${alias}.service_instance_id = ?`); params.push(filters.serviceInstanceId); }
  if (filters.serviceVersion) { conditions.push(`${alias}.service_version = ?`); params.push(filters.serviceVersion); }
  if (filters.deploymentEnvironment) { conditions.push(`${alias}.deployment_environment = ?`); params.push(filters.deploymentEnvironment); }
  if (filters.containerId) { conditions.push(`${alias}.container_id = ?`); params.push(filters.containerId); }
  pushTextCondition(conditions, params, `${alias}.container_name`, filters.containerName, filters.containerNameMatch);
  pushTextCondition(conditions, params, `${alias}.k8s_namespace`, filters.k8sNamespace, filters.k8sNamespaceMatch);
  if (filters.k8sPodName) { conditions.push(`${alias}.k8s_pod_name = ?`); params.push(filters.k8sPodName); }
  if (filters.k8sContainerName) { conditions.push(`${alias}.k8s_container_name = ?`); params.push(filters.k8sContainerName); }
  if (filters.serverAddress) { conditions.push(`${alias}.server_address = ?`); params.push(filters.serverAddress); }
  if (filters.serverPort !== undefined) { conditions.push(`${alias}.server_port = ?`); params.push(filters.serverPort); }
  if (filters.clientAddress) { conditions.push(`${alias}.client_address = ?`); params.push(filters.clientAddress); }

  return { conditions, params };
}

function buildWhere(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

export async function tracesRoutes(fastify: FastifyInstance) {
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
    const {
      from,
      to,
      serviceName,
      status,
      source,
      minDuration,
      httpMethod,
      httpRoute,
      httpRouteMatch,
      httpStatusCode,
      serviceNamespace,
      serviceNamespaceMatch,
      serviceInstanceId,
      serviceVersion,
      deploymentEnvironment,
      containerId,
      containerName,
      containerNameMatch,
      k8sNamespace,
      k8sNamespaceMatch,
      k8sPodName,
      k8sContainerName,
      serverAddress,
      serverPort,
      clientAddress,
      limit = 50,
    } = request.query as TraceFilters & { limit?: number };

    const db = getDb();
    const { conditions, params } = buildSpanConditions({
      from,
      to,
      serviceName,
      status,
      source,
      minDuration,
      httpMethod,
      httpRoute,
      httpRouteMatch,
      httpStatusCode,
      serviceNamespace,
      serviceNamespaceMatch,
      serviceInstanceId,
      serviceVersion,
      deploymentEnvironment,
      containerId,
      containerName,
      containerNameMatch,
      k8sNamespace,
      k8sNamespaceMatch,
      k8sPodName,
      k8sContainerName,
      serverAddress,
      serverPort,
      clientAddress,
    }, 's');

    // Only get root spans (no parent)
    conditions.push('s.parent_span_id IS NULL');

    const where = buildWhere(conditions);

    const traces = db.prepare(`
      SELECT s.trace_id, s.name as root_span, s.duration_ms, s.status, s.service_name,
             s.start_time, s.trace_source,
             s.http_method, s.http_route, s.http_status_code,
             s.service_namespace, s.service_instance_id, s.service_version, s.deployment_environment,
             s.container_id, s.container_name,
             s.k8s_namespace, s.k8s_pod_name, s.k8s_container_name,
             s.server_address, s.server_port, s.client_address,
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
    const {
      from,
      to,
      serviceName,
      status,
      source,
      minDuration,
      httpMethod,
      httpRoute,
      httpRouteMatch,
      httpStatusCode,
      serviceNamespace,
      serviceNamespaceMatch,
      serviceInstanceId,
      serviceVersion,
      deploymentEnvironment,
      containerId,
      containerName,
      containerNameMatch,
      k8sNamespace,
      k8sNamespaceMatch,
      k8sPodName,
      k8sContainerName,
      serverAddress,
      serverPort,
      clientAddress,
    } = request.query as TraceFilters;

    const db = getDb();
    const { conditions, params } = buildSpanConditions({
      from,
      to,
      serviceName,
      status,
      source,
      minDuration,
      httpMethod,
      httpRoute,
      httpRouteMatch,
      httpStatusCode,
      serviceNamespace,
      serviceNamespaceMatch,
      serviceInstanceId,
      serviceVersion,
      deploymentEnvironment,
      containerId,
      containerName,
      containerNameMatch,
      k8sNamespace,
      k8sNamespaceMatch,
      k8sPodName,
      k8sContainerName,
      serverAddress,
      serverPort,
      clientAddress,
    }, 's');

    const where = buildWhere(conditions);

    const nodes = db.prepare(`
      SELECT s.service_name as id, s.service_name as name,
             COUNT(*) as callCount,
             AVG(s.duration_ms) as avgDuration,
             CAST(SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as errorRate
      FROM spans s
      ${where}
      GROUP BY s.service_name
    `).all(...params);

    const childConditions = conditions.map((condition) => condition.replaceAll('s.', 'c.'));
    const childWhere = buildWhere(childConditions);

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
      querystring: TracesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const {
      from,
      to,
      serviceName,
      status,
      source,
      minDuration,
      httpMethod,
      httpRoute,
      httpRouteMatch,
      httpStatusCode,
      serviceNamespace,
      serviceNamespaceMatch,
      serviceInstanceId,
      serviceVersion,
      deploymentEnvironment,
      containerId,
      containerName,
      containerNameMatch,
      k8sNamespace,
      k8sNamespaceMatch,
      k8sPodName,
      k8sContainerName,
      serverAddress,
      serverPort,
      clientAddress,
    } = request.query as TraceFilters;

    const db = getDb();
    const { conditions, params } = buildSpanConditions({
      from,
      to,
      serviceName,
      status,
      source,
      minDuration,
      httpMethod,
      httpRoute,
      httpStatusCode,
      serviceNamespace,
      serviceInstanceId,
      serviceVersion,
      deploymentEnvironment,
      containerId,
      containerName,
      k8sNamespace,
      k8sPodName,
      k8sContainerName,
      serverAddress,
      serverPort,
      clientAddress,
    }, 's');

    conditions.push('s.parent_span_id IS NULL');
    const where = buildWhere(conditions);

    const summary = db.prepare(`
      SELECT
        COUNT(DISTINCT s.trace_id) as totalTraces,
        AVG(s.duration_ms) as avgDuration,
        CAST(SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) as errorRate,
        COUNT(DISTINCT s.service_name) as services
      FROM spans s
      ${where}
    `).get(...params) as { totalTraces: number; avgDuration: number | null; errorRate: number | null; services: number };

    const bySource = db.prepare(`
      SELECT COALESCE(NULLIF(s.trace_source, ''), 'unknown') as source,
             COUNT(DISTINCT s.trace_id) as total
      FROM spans s
      ${where}
      GROUP BY COALESCE(NULLIF(s.trace_source, ''), 'unknown')
    `).all(...params) as Array<{ source: string; total: number }>;

    const sourceCounts = {
      http: 0,
      ebpf: 0,
      scheduler: 0,
      unknown: 0,
    };

    for (const row of bySource) {
      const normalized = row.source.toLowerCase();
      if (normalized === 'http') sourceCounts.http += row.total;
      else if (normalized === 'ebpf') sourceCounts.ebpf += row.total;
      else if (normalized === 'scheduler') sourceCounts.scheduler += row.total;
      else sourceCounts.unknown += row.total;
    }

    return {
      totalTraces: summary.totalTraces ?? 0,
      avgDuration: Math.round((summary.avgDuration ?? 0) * 100) / 100,
      errorRate: Math.round((summary.errorRate ?? 0) * 10000) / 10000,
      services: summary.services ?? 0,
      sourceCounts,
    };
  });
}
