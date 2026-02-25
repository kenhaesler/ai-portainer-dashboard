import { FastifyInstance } from 'fastify';
import { getDbForDomain } from '../../../core/db/app-db-router.js';
import { TracesQuerySchema, TraceIdParamsSchema } from '../../../core/models/api-schemas.js';

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
  urlFull?: string;
  urlFullMatch?: 'exact' | 'contains';
  urlScheme?: string;
  networkTransport?: string;
  networkProtocolName?: string;
  networkProtocolVersion?: string;
  netPeerName?: string;
  netPeerNameMatch?: 'exact' | 'contains';
  netPeerPort?: number;
  hostName?: string;
  hostNameMatch?: 'exact' | 'contains';
  osType?: string;
  processPid?: number;
  processExecutableName?: string;
  processExecutableNameMatch?: 'exact' | 'contains';
  processCommand?: string;
  processCommandMatch?: 'exact' | 'contains';
  telemetrySdkName?: string;
  telemetrySdkLanguage?: string;
  telemetrySdkVersion?: string;
  otelScopeName?: string;
  otelScopeVersion?: string;
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
  pushTextCondition(conditions, params, `${alias}.url_full`, filters.urlFull, filters.urlFullMatch);
  if (filters.urlScheme) { conditions.push(`${alias}.url_scheme = ?`); params.push(filters.urlScheme); }
  if (filters.networkTransport) { conditions.push(`${alias}.network_transport = ?`); params.push(filters.networkTransport); }
  if (filters.networkProtocolName) { conditions.push(`${alias}.network_protocol_name = ?`); params.push(filters.networkProtocolName); }
  if (filters.networkProtocolVersion) { conditions.push(`${alias}.network_protocol_version = ?`); params.push(filters.networkProtocolVersion); }
  pushTextCondition(conditions, params, `${alias}.net_peer_name`, filters.netPeerName, filters.netPeerNameMatch);
  if (filters.netPeerPort !== undefined) { conditions.push(`${alias}.net_peer_port = ?`); params.push(filters.netPeerPort); }
  pushTextCondition(conditions, params, `${alias}.host_name`, filters.hostName, filters.hostNameMatch);
  if (filters.osType) { conditions.push(`${alias}.os_type = ?`); params.push(filters.osType); }
  if (filters.processPid !== undefined) { conditions.push(`${alias}.process_pid = ?`); params.push(filters.processPid); }
  pushTextCondition(conditions, params, `${alias}.process_executable_name`, filters.processExecutableName, filters.processExecutableNameMatch);
  pushTextCondition(conditions, params, `${alias}.process_command`, filters.processCommand, filters.processCommandMatch);
  if (filters.telemetrySdkName) { conditions.push(`${alias}.telemetry_sdk_name = ?`); params.push(filters.telemetrySdkName); }
  if (filters.telemetrySdkLanguage) { conditions.push(`${alias}.telemetry_sdk_language = ?`); params.push(filters.telemetrySdkLanguage); }
  if (filters.telemetrySdkVersion) { conditions.push(`${alias}.telemetry_sdk_version = ?`); params.push(filters.telemetrySdkVersion); }
  if (filters.otelScopeName) { conditions.push(`${alias}.otel_scope_name = ?`); params.push(filters.otelScopeName); }
  if (filters.otelScopeVersion) { conditions.push(`${alias}.otel_scope_version = ?`); params.push(filters.otelScopeVersion); }

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
      urlFull,
      urlFullMatch,
      urlScheme,
      networkTransport,
      networkProtocolName,
      networkProtocolVersion,
      netPeerName,
      netPeerNameMatch,
      netPeerPort,
      hostName,
      hostNameMatch,
      osType,
      processPid,
      processExecutableName,
      processExecutableNameMatch,
      processCommand,
      processCommandMatch,
      telemetrySdkName,
      telemetrySdkLanguage,
      telemetrySdkVersion,
      otelScopeName,
      otelScopeVersion,
      limit = 50,
    } = request.query as TraceFilters & { limit?: number };

    const db = getDbForDomain('traces');
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
      urlFull,
      urlFullMatch,
      urlScheme,
      networkTransport,
      networkProtocolName,
      networkProtocolVersion,
      netPeerName,
      netPeerNameMatch,
      netPeerPort,
      hostName,
      hostNameMatch,
      osType,
      processPid,
      processExecutableName,
      processExecutableNameMatch,
      processCommand,
      processCommandMatch,
      telemetrySdkName,
      telemetrySdkLanguage,
      telemetrySdkVersion,
      otelScopeName,
      otelScopeVersion,
    }, 's');

    // Only get root spans (no parent)
    conditions.push('s.parent_span_id IS NULL');

    const where = buildWhere(conditions);

    const traces = await db.query<any>(`
      SELECT s.trace_id, s.name as root_span, s.duration_ms, s.status, s.service_name,
             s.start_time, s.trace_source,
             s.http_method, s.http_route, s.http_status_code,
             s.service_namespace, s.service_instance_id, s.service_version, s.deployment_environment,
             s.container_id, s.container_name,
             s.k8s_namespace, s.k8s_pod_name, s.k8s_container_name,
             s.server_address, s.server_port, s.client_address,
             s.url_full, s.url_scheme,
             s.network_transport, s.network_protocol_name, s.network_protocol_version,
             s.net_peer_name, s.net_peer_port,
             s.host_name, s.os_type,
             s.process_pid, s.process_executable_name, s.process_command,
             s.telemetry_sdk_name, s.telemetry_sdk_language, s.telemetry_sdk_version,
             s.otel_scope_name, s.otel_scope_version,
             (SELECT COUNT(*)::integer FROM spans s2 WHERE s2.trace_id = s.trace_id) as span_count
      FROM spans s
      ${where}
      ORDER BY s.start_time DESC
      LIMIT ?
    `, [...params, limit]);

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
    const db = getDbForDomain('traces');

    const spans = await db.query<any>(
      'SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC',
      [traceId]
    );

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
      urlFull,
      urlFullMatch,
      urlScheme,
      networkTransport,
      networkProtocolName,
      networkProtocolVersion,
      netPeerName,
      netPeerNameMatch,
      netPeerPort,
      hostName,
      hostNameMatch,
      osType,
      processPid,
      processExecutableName,
      processExecutableNameMatch,
      processCommand,
      processCommandMatch,
      telemetrySdkName,
      telemetrySdkLanguage,
      telemetrySdkVersion,
      otelScopeName,
      otelScopeVersion,
    } = request.query as TraceFilters;

    const db = getDbForDomain('traces');
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
      urlFull,
      urlFullMatch,
      urlScheme,
      networkTransport,
      networkProtocolName,
      networkProtocolVersion,
      netPeerName,
      netPeerNameMatch,
      netPeerPort,
      hostName,
      hostNameMatch,
      osType,
      processPid,
      processExecutableName,
      processExecutableNameMatch,
      processCommand,
      processCommandMatch,
      telemetrySdkName,
      telemetrySdkLanguage,
      telemetrySdkVersion,
      otelScopeName,
      otelScopeVersion,
    }, 's');

    const where = buildWhere(conditions);

    const nodes = await db.query<any>(`
      SELECT s.service_name as id, s.service_name as name,
             COUNT(*)::integer as "callCount",
             AVG(s.duration_ms)::float as "avgDuration",
             (SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END)::float / COUNT(*)) as "errorRate"
      FROM spans s
      ${where}
      GROUP BY s.service_name
    `, [...params]);

    const childConditions = conditions.map((condition) => condition.replaceAll('s.', 'c.'));
    const childWhere = buildWhere(childConditions);

    const edges = await db.query<any>(`
      SELECT p.service_name as source, c.service_name as target,
             COUNT(*)::integer as "callCount",
             AVG(c.duration_ms)::float as "avgDuration"
      FROM spans c
      JOIN spans p ON c.parent_span_id = p.id
      ${childWhere}${childWhere ? ' AND ' : ' WHERE '}p.service_name != c.service_name
      GROUP BY p.service_name, c.service_name
    `, [...params]);

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
      urlFull,
      urlFullMatch,
      urlScheme,
      networkTransport,
      networkProtocolName,
      networkProtocolVersion,
      netPeerName,
      netPeerNameMatch,
      netPeerPort,
      hostName,
      hostNameMatch,
      osType,
      processPid,
      processExecutableName,
      processExecutableNameMatch,
      processCommand,
      processCommandMatch,
      telemetrySdkName,
      telemetrySdkLanguage,
      telemetrySdkVersion,
      otelScopeName,
      otelScopeVersion,
    } = request.query as TraceFilters;

    const db = getDbForDomain('traces');
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
      urlFull,
      urlFullMatch,
      urlScheme,
      networkTransport,
      networkProtocolName,
      networkProtocolVersion,
      netPeerName,
      netPeerNameMatch,
      netPeerPort,
      hostName,
      hostNameMatch,
      osType,
      processPid,
      processExecutableName,
      processExecutableNameMatch,
      processCommand,
      processCommandMatch,
      telemetrySdkName,
      telemetrySdkLanguage,
      telemetrySdkVersion,
      otelScopeName,
      otelScopeVersion,
    }, 's');

    conditions.push('s.parent_span_id IS NULL');
    const where = buildWhere(conditions);

    const summary = await db.queryOne<{ totalTraces: number; avgDuration: number | null; errorRate: number | null; services: number }>(`
      SELECT
        COUNT(DISTINCT s.trace_id)::integer as "totalTraces",
        AVG(s.duration_ms)::float as "avgDuration",
        (SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) as "errorRate",
        COUNT(DISTINCT s.service_name)::integer as services
      FROM spans s
      ${where}
    `, [...params]);

    const bySource = await db.query<{ source: string; total: number }>(`
      SELECT COALESCE(NULLIF(s.trace_source, ''), 'unknown') as source,
             COUNT(DISTINCT s.trace_id)::integer as total
      FROM spans s
      ${where}
      GROUP BY COALESCE(NULLIF(s.trace_source, ''), 'unknown')
    `, [...params]);

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
      totalTraces: summary?.totalTraces ?? 0,
      avgDuration: Math.round((summary?.avgDuration ?? 0) * 100) / 100,
      errorRate: Math.round((summary?.errorRate ?? 0) * 10000) / 10000,
      services: summary?.services ?? 0,
      sourceCounts,
    };
  });
}
