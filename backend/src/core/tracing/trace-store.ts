import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';
import type { Span, ServiceMapNode, ServiceMapEdge } from '../models/tracing.js';

const log = createChildLogger('trace-store');

export interface SpanInsert {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: 'client' | 'server' | 'internal';
  status: 'ok' | 'error' | 'unset';
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
  service_name: string;
  attributes: string;
  trace_source?: string;
  http_method?: string | null;
  http_route?: string | null;
  http_status_code?: number | null;
  service_namespace?: string | null;
  service_instance_id?: string | null;
  service_version?: string | null;
  deployment_environment?: string | null;
  container_id?: string | null;
  container_name?: string | null;
  k8s_namespace?: string | null;
  k8s_pod_name?: string | null;
  k8s_container_name?: string | null;
  server_address?: string | null;
  server_port?: number | null;
  client_address?: string | null;
  url_full?: string | null;
  url_scheme?: string | null;
  network_transport?: string | null;
  network_protocol_name?: string | null;
  network_protocol_version?: string | null;
  net_peer_name?: string | null;
  net_peer_port?: number | null;
  host_name?: string | null;
  os_type?: string | null;
  process_pid?: number | null;
  process_executable_name?: string | null;
  process_command?: string | null;
  telemetry_sdk_name?: string | null;
  telemetry_sdk_language?: string | null;
  telemetry_sdk_version?: string | null;
  otel_scope_name?: string | null;
  otel_scope_version?: string | null;
}

const INSERT_SQL = `
  INSERT INTO spans (
    id, trace_id, parent_span_id, name, kind, status,
    start_time, end_time, duration_ms, service_name, attributes, trace_source,
    http_method, http_route, http_status_code,
    service_namespace, service_instance_id, service_version, deployment_environment,
    container_id, container_name,
    k8s_namespace, k8s_pod_name, k8s_container_name,
    server_address, server_port, client_address,
    url_full, url_scheme,
    network_transport, network_protocol_name, network_protocol_version,
    net_peer_name, net_peer_port,
    host_name, os_type,
    process_pid, process_executable_name, process_command,
    telemetry_sdk_name, telemetry_sdk_language, telemetry_sdk_version,
    otel_scope_name, otel_scope_version,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
`;

function spanToParams(span: SpanInsert, defaultSource: string): unknown[] {
  return [
    span.id,
    span.trace_id,
    span.parent_span_id,
    span.name,
    span.kind,
    span.status,
    span.start_time,
    span.end_time,
    span.duration_ms,
    span.service_name,
    span.attributes,
    span.trace_source ?? defaultSource,
    span.http_method ?? null,
    span.http_route ?? null,
    span.http_status_code ?? null,
    span.service_namespace ?? null,
    span.service_instance_id ?? null,
    span.service_version ?? null,
    span.deployment_environment ?? null,
    span.container_id ?? null,
    span.container_name ?? null,
    span.k8s_namespace ?? null,
    span.k8s_pod_name ?? null,
    span.k8s_container_name ?? null,
    span.server_address ?? null,
    span.server_port ?? null,
    span.client_address ?? null,
    span.url_full ?? null,
    span.url_scheme ?? null,
    span.network_transport ?? null,
    span.network_protocol_name ?? null,
    span.network_protocol_version ?? null,
    span.net_peer_name ?? null,
    span.net_peer_port ?? null,
    span.host_name ?? null,
    span.os_type ?? null,
    span.process_pid ?? null,
    span.process_executable_name ?? null,
    span.process_command ?? null,
    span.telemetry_sdk_name ?? null,
    span.telemetry_sdk_language ?? null,
    span.telemetry_sdk_version ?? null,
    span.otel_scope_name ?? null,
    span.otel_scope_version ?? null,
  ];
}

export async function insertSpan(span: SpanInsert): Promise<void> {
  const db = getDbForDomain('traces');
  await db.execute(INSERT_SQL, spanToParams(span, 'http'));
  log.debug({ spanId: span.id, traceId: span.trace_id }, 'Span inserted');
}

export async function insertSpans(spans: SpanInsert[]): Promise<number> {
  if (spans.length === 0) return 0;

  const db = getDbForDomain('traces');

  const count = await db.transaction(async (txDb) => {
    let inserted = 0;
    for (const span of spans) {
      await txDb.execute(INSERT_SQL, spanToParams(span, 'ebpf'));
      inserted++;
    }
    return inserted;
  });

  log.info({ count }, 'Batch inserted spans');
  return count;
}

export async function getTrace(traceId: string): Promise<Span[]> {
  const db = getDbForDomain('traces');
  return db.query<Span>(
    `SELECT * FROM spans
     WHERE trace_id = ?
     ORDER BY start_time ASC`,
    [traceId],
  );
}

export interface GetTracesOptions {
  from?: string;
  to?: string;
  serviceName?: string;
  status?: string;
  source?: string;
  limit?: number;
}

export async function getTraces(options: GetTracesOptions = {}): Promise<Array<{
  trace_id: string;
  root_service: string;
  root_name: string;
  start_time: string;
  duration_ms: number | null;
  span_count: number;
  status: string;
}>> {
  const db = getDbForDomain('traces');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.from) {
    conditions.push('s.start_time >= ?');
    params.push(options.from);
  }

  if (options.to) {
    conditions.push('s.start_time <= ?');
    params.push(options.to);
  }

  if (options.serviceName) {
    conditions.push('s.service_name = ?');
    params.push(options.serviceName);
  }

  if (options.status) {
    conditions.push('s.status = ?');
    params.push(options.status);
  }

  if (options.source) {
    conditions.push('s.trace_source = ?');
    params.push(options.source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;

  return db.query<{
    trace_id: string;
    root_service: string;
    root_name: string;
    start_time: string;
    duration_ms: number | null;
    span_count: number;
    status: string;
  }>(
    `SELECT
       s.trace_id,
       MIN(s.service_name) as root_service,
       MIN(s.name) as root_name,
       MIN(s.start_time) as start_time,
       SUM(s.duration_ms) as duration_ms,
       COUNT(*)::integer as span_count,
       CASE WHEN SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) > 0
            THEN 'error' ELSE 'ok' END as status
     FROM spans s
     ${where}
     GROUP BY s.trace_id
     ORDER BY MIN(s.start_time) DESC
     LIMIT ?`,
    [...params, limit],
  );
}

export async function getServiceMap(): Promise<{
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}> {
  const db = getDbForDomain('traces');

  // Get unique services with their stats
  const nodes = await db.query<ServiceMapNode>(
    `SELECT
       service_name as id,
       service_name as name,
       COUNT(*)::integer as "callCount",
       AVG(duration_ms) as "avgDuration",
       CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as "errorRate"
     FROM spans
     GROUP BY service_name`,
  );

  // Get edges: parent service -> child service
  const edges = await db.query<ServiceMapEdge>(
    `SELECT
       parent.service_name as source,
       child.service_name as target,
       COUNT(*)::integer as "callCount",
       AVG(child.duration_ms) as "avgDuration"
     FROM spans child
     INNER JOIN spans parent ON child.parent_span_id = parent.id
     WHERE parent.service_name != child.service_name
     GROUP BY parent.service_name, child.service_name`,
  );

  return { nodes, edges };
}

export async function getTraceSummary(
  from?: string,
  to?: string,
): Promise<{
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
  services: number;
}> {
  const db = getDbForDomain('traces');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (from) {
    conditions.push('start_time >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('start_time <= ?');
    params.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.queryOne<{
    totalTraces: number;
    avgDuration: number | null;
    errorRate: number | null;
    services: number;
  }>(
    `SELECT
       COUNT(DISTINCT trace_id) as "totalTraces",
       AVG(duration_ms) as "avgDuration",
       CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) /
         NULLIF(COUNT(*), 0) as "errorRate",
       COUNT(DISTINCT service_name) as services
     FROM spans
     ${where}`,
    params,
  );

  return {
    totalTraces: result?.totalTraces ?? 0,
    avgDuration: Math.round((result?.avgDuration ?? 0) * 100) / 100,
    errorRate: Math.round((result?.errorRate ?? 0) * 10000) / 10000,
    services: result?.services ?? 0,
  };
}
