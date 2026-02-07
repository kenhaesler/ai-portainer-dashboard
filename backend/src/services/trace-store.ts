import { getDb } from '../db/sqlite.js';
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
}

export function insertSpan(span: SpanInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO spans (
      id, trace_id, parent_span_id, name, kind, status,
      start_time, end_time, duration_ms, service_name, attributes, trace_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
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
    span.trace_source ?? 'http',
  );

  log.debug({ spanId: span.id, traceId: span.trace_id }, 'Span inserted');
}

export function insertSpans(spans: SpanInsert[]): number {
  if (spans.length === 0) return 0;

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO spans (
      id, trace_id, parent_span_id, name, kind, status,
      start_time, end_time, duration_ms, service_name, attributes, trace_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = db.transaction((items: SpanInsert[]) => {
    let count = 0;
    for (const span of items) {
      stmt.run(
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
        span.trace_source ?? 'ebpf',
      );
      count++;
    }
    return count;
  });

  const count = insertMany(spans);
  log.info({ count }, 'Batch inserted spans');
  return count;
}

export function getTrace(traceId: string): Span[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM spans
       WHERE trace_id = ?
       ORDER BY start_time ASC`,
    )
    .all(traceId) as Span[];
}

export interface GetTracesOptions {
  from?: string;
  to?: string;
  serviceName?: string;
  status?: string;
  source?: string;
  limit?: number;
}

export function getTraces(options: GetTracesOptions = {}): Array<{
  trace_id: string;
  root_service: string;
  root_name: string;
  start_time: string;
  duration_ms: number | null;
  span_count: number;
  status: string;
}> {
  const db = getDb();
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

  return db
    .prepare(
      `SELECT
         s.trace_id,
         MIN(s.service_name) as root_service,
         MIN(s.name) as root_name,
         MIN(s.start_time) as start_time,
         SUM(s.duration_ms) as duration_ms,
         COUNT(*) as span_count,
         CASE WHEN SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) > 0
              THEN 'error' ELSE 'ok' END as status
       FROM spans s
       ${where}
       GROUP BY s.trace_id
       ORDER BY MIN(s.start_time) DESC
       LIMIT ?`,
    )
    .all(...params, limit) as Array<{
    trace_id: string;
    root_service: string;
    root_name: string;
    start_time: string;
    duration_ms: number | null;
    span_count: number;
    status: string;
  }>;
}

export function getServiceMap(): {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
} {
  const db = getDb();

  // Get unique services with their stats
  const nodes = db
    .prepare(
      `SELECT
         service_name as id,
         service_name as name,
         COUNT(*) as callCount,
         AVG(duration_ms) as avgDuration,
         CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as errorRate
       FROM spans
       GROUP BY service_name`,
    )
    .all() as ServiceMapNode[];

  // Get edges: parent service -> child service
  const edges = db
    .prepare(
      `SELECT
         parent.service_name as source,
         child.service_name as target,
         COUNT(*) as callCount,
         AVG(child.duration_ms) as avgDuration
       FROM spans child
       INNER JOIN spans parent ON child.parent_span_id = parent.id
       WHERE parent.service_name != child.service_name
       GROUP BY parent.service_name, child.service_name`,
    )
    .all() as ServiceMapEdge[];

  return { nodes, edges };
}

export function getTraceSummary(
  from?: string,
  to?: string,
): {
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
} {
  const db = getDb();
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

  const result = db
    .prepare(
      `SELECT
         COUNT(DISTINCT trace_id) as totalTraces,
         AVG(duration_ms) as avgDuration,
         CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) /
           NULLIF(COUNT(*), 0) as errorRate
       FROM spans
       ${where}`,
    )
    .get(...params) as {
    totalTraces: number;
    avgDuration: number | null;
    errorRate: number | null;
  };

  return {
    totalTraces: result.totalTraces ?? 0,
    avgDuration: Math.round((result.avgDuration ?? 0) * 100) / 100,
    errorRate: Math.round((result.errorRate ?? 0) * 10000) / 10000,
  };
}
