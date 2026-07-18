import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { tracesRoutes } from '../routes/traces.js';

let appDb: AppDb;

async function insertSpan(span: {
  id: string;
  traceId: string;
  parentSpanId?: string | null;
  name: string;
  kind: string;
  status: string;
  startTime: string;
  duration: number;
  service: string;
  source: string;
  httpMethod?: string | null;
  httpRoute?: string | null;
  httpStatusCode?: number | null;
  serviceNamespace?: string | null;
  containerName?: string | null;
  k8sNamespace?: string | null;
  urlFull?: string | null;
  networkTransport?: string | null;
  hostName?: string | null;
  telemetrySdkName?: string | null;
}) {
  await appDb.execute(`
    INSERT INTO spans (
      id, trace_id, parent_span_id, name, kind, status,
      start_time, end_time, duration_ms, service_name, attributes, trace_source,
      http_method, http_route, http_status_code,
      service_namespace, container_name, k8s_namespace,
      url_full, network_transport, host_name, telemetry_sdk_name,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `,
    [
      span.id,
      span.traceId,
      span.parentSpanId ?? null,
      span.name,
      span.kind,
      span.status,
      span.startTime,
      span.startTime,
      span.duration,
      span.service,
      span.source,
      span.httpMethod ?? null,
      span.httpRoute ?? null,
      span.httpStatusCode ?? null,
      span.serviceNamespace ?? null,
      span.containerName ?? null,
      span.k8sNamespace ?? null,
      span.urlFull ?? null,
      span.networkTransport ?? null,
      span.hostName ?? null,
      span.telemetrySdkName ?? null,
    ],
  );
}

beforeAll(async () => {
  appDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('spans');
});

describe('traces routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    await app.register(async (instance) => {
      instance.decorate('authenticate', async () => undefined);
      instance.decorate('requireRole', () => async () => undefined);
      await tracesRoutes(instance);
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/traces supports typed OTLP filters', async () => {
    await insertSpan({
      id: 'typed-ok',
      traceId: 'trace-typed',
      name: 'GET /users',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 120,
      service: 'api',
      source: 'ebpf',
      httpMethod: 'GET',
      httpRoute: '/users/:id',
      httpStatusCode: 200,
      serviceNamespace: 'prod-eu-1',
      containerName: 'api-1',
      k8sNamespace: 'payments',
      urlFull: 'https://api.internal/users/42',
      networkTransport: 'tcp',
      hostName: 'node-a',
      telemetrySdkName: 'opentelemetry',
    });

    await insertSpan({
      id: 'typed-miss',
      traceId: 'trace-miss',
      name: 'POST /users',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:01:00.000Z',
      duration: 180,
      service: 'api',
      source: 'ebpf',
      httpMethod: 'POST',
      httpStatusCode: 500,
      serviceNamespace: 'staging',
      containerName: 'api-2',
      k8sNamespace: 'ops',
      urlFull: 'https://ops.internal/users',
      networkTransport: 'udp',
      hostName: 'node-b',
      telemetrySdkName: 'custom-sdk',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/traces?httpMethod=GET&httpRoute=users&httpRouteMatch=contains&serviceNamespace=prod&serviceNamespaceMatch=contains&containerName=api&containerNameMatch=contains&k8sNamespace=pay&k8sNamespaceMatch=contains&urlFull=api.internal&urlFullMatch=contains&networkTransport=tcp&hostName=node&hostNameMatch=contains&telemetrySdkName=opentelemetry',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { traces: Array<{ trace_id: string; http_method: string }> };
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0].trace_id).toBe('trace-typed');
    expect(body.traces[0].http_method).toBe('GET');
  });

  it('GET /api/traces preserves every schema-enumerated column, including NULLs (#1545)', async () => {
    // The response schema (TraceListItemSchema) does a full Zod parse. Assert
    // it enumerates the whole SELECT — populated AND absent OTLP columns — so a
    // nullable column that the frontend reads is never silently stripped, and a
    // NULL value serialises as null rather than throwing.
    await insertSpan({
      id: 'shape-root',
      traceId: 'trace-shape',
      name: 'GET /orders',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 42,
      service: 'orders',
      source: 'ebpf',
      httpMethod: 'GET',
      httpStatusCode: 200,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/traces?serviceName=orders',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const row = (response.json() as { traces: Array<Record<string, unknown>> }).traces[0];

    // Populated, non-null columns.
    expect(row.trace_id).toBe('trace-shape');
    expect(row.root_span).toBe('GET /orders');
    expect(row.duration_ms).toBe(42);
    expect(row.status).toBe('ok');
    expect(row.service_name).toBe('orders');
    expect(typeof row.start_time).toBe('string');
    expect(row.span_count).toBe(1);

    // Nullable columns the frontend reads must be PRESENT (as null), not dropped.
    for (const key of [
      'server_port', 'net_peer_port', 'process_pid', 'url_scheme',
      'service_instance_id', 'client_address', 'os_type', 'otel_scope_name',
    ]) {
      expect(row, `nullable column "${key}" was stripped by the response schema`).toHaveProperty(key);
      expect(row[key]).toBeNull();
    }
  });

  it('GET /api/traces/service-map uses source + time filters', async () => {
    await insertSpan({
      id: 'root-http',
      traceId: 'trace-http',
      name: 'GET /old',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-10T10:00:00.000Z',
      duration: 100,
      service: 'api',
      source: 'http',
    });

    await insertSpan({
      id: 'root-ebpf',
      traceId: 'trace-ebpf',
      name: 'GET /users',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 300,
      service: 'api',
      source: 'ebpf',
    });

    await insertSpan({
      id: 'child-ebpf',
      traceId: 'trace-ebpf',
      parentSpanId: 'root-ebpf',
      name: 'SELECT users',
      kind: 'internal',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.100Z',
      duration: 120,
      service: 'db',
      source: 'ebpf',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/traces/service-map?from=2026-02-12T00:00:00.000Z&source=ebpf',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      nodes: Array<{ id: string; callCount: number }>;
      edges: Array<{ source: string; target: string; callCount: number }>;
    };

    expect(body.nodes).toHaveLength(2);
    expect(body.nodes.find((n) => n.id === 'api')?.callCount).toBe(1);
    expect(body.nodes.find((n) => n.id === 'db')?.callCount).toBe(1);
    expect(body.edges).toEqual([
      expect.objectContaining({ source: 'api', target: 'db', callCount: 1 }),
    ]);
  });

  it('GET /api/traces/summary returns source-scoped counters', async () => {
    await insertSpan({
      id: 'sum-http',
      traceId: 'trace-http',
      name: 'GET /http',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 120,
      service: 'gateway',
      source: 'http',
    });

    await insertSpan({
      id: 'sum-ebpf',
      traceId: 'trace-ebpf',
      name: 'GET /ebpf',
      kind: 'server',
      status: 'error',
      startTime: '2026-02-12T10:05:00.000Z',
      duration: 320,
      service: 'api',
      source: 'ebpf',
      httpMethod: 'GET',
    });

    await insertSpan({
      id: 'sum-scheduler',
      traceId: 'trace-scheduler',
      name: 'job:cleanup',
      kind: 'internal',
      status: 'ok',
      startTime: '2026-02-12T10:06:00.000Z',
      duration: 90,
      service: 'scheduler',
      source: 'scheduler',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/traces/summary?from=2026-02-12T00:00:00.000Z',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      totalTraces: number;
      avgDuration: number;
      errorRate: number;
      services: number;
      sourceCounts: { http: number; ebpf: number; scheduler: number; unknown: number };
    };

    expect(body.totalTraces).toBe(3);
    expect(body.avgDuration).toBeCloseTo(176.67, 2);
    expect(body.errorRate).toBeCloseTo(0.3333, 4);
    expect(body.services).toBe(3);
    expect(body.sourceCounts).toEqual({ http: 1, ebpf: 1, scheduler: 1, unknown: 0 });
  });

  it('GET /api/traces/summary applies the same *Match modes as the list route (#1538)', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await insertSpan({
      id: 'match-hit',
      traceId: 'trace-hit',
      name: 'GET /users',
      kind: 'server',
      status: 'ok',
      startTime: recent,
      duration: 100,
      service: 'api',
      source: 'ebpf',
      httpRoute: '/users/:id',
      serviceNamespace: 'prod-eu-1',
      containerName: 'api-1',
      k8sNamespace: 'payments',
    });

    await insertSpan({
      id: 'match-miss',
      traceId: 'trace-miss',
      name: 'GET /orders',
      kind: 'server',
      status: 'ok',
      startTime: recent,
      duration: 100,
      service: 'api',
      source: 'ebpf',
      httpRoute: '/orders',
      serviceNamespace: 'staging',
      containerName: 'web-2',
      k8sNamespace: 'ops',
    });

    // Contains-mode filters on the four fields the summary route used to drop.
    // The values only match as substrings, so a silent exact-equality fallback
    // would return zero rows.
    const filters =
      `from=${encodeURIComponent(from)}` +
      '&httpRoute=users&httpRouteMatch=contains' +
      '&serviceNamespace=prod&serviceNamespaceMatch=contains' +
      '&containerName=api&containerNameMatch=contains' +
      '&k8sNamespace=pay&k8sNamespaceMatch=contains';

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/traces?${filters}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json() as { traces: Array<{ trace_id: string }> };
    expect(listBody.traces.map((t) => t.trace_id)).toEqual(['trace-hit']);

    const summaryResponse = await app.inject({
      method: 'GET',
      url: `/api/traces/summary?${filters}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(summaryResponse.statusCode).toBe(200);
    const summaryBody = summaryResponse.json() as { totalTraces: number };
    // Summary must agree with the list under the same filters
    expect(summaryBody.totalTraces).toBe(listBody.traces.length);
  });

  it('GET /api/traces/service-map defaults to the last hour when from is omitted (#1528)', async () => {
    await insertSpan({
      id: 'old-root',
      traceId: 'trace-old',
      name: 'GET /old',
      kind: 'server',
      status: 'ok',
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      duration: 100,
      service: 'old-svc',
      source: 'http',
    });

    await insertSpan({
      id: 'fresh-root',
      traceId: 'trace-fresh',
      name: 'GET /fresh',
      kind: 'server',
      status: 'ok',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 100,
      service: 'fresh-svc',
      source: 'http',
    });

    const defaulted = await app.inject({
      method: 'GET',
      url: '/api/traces/service-map',
      headers: { authorization: 'Bearer test' },
    });
    expect(defaulted.statusCode).toBe(200);
    const defaultedBody = defaulted.json() as { nodes: Array<{ id: string }> };
    expect(defaultedBody.nodes.map((n) => n.id)).toEqual(['fresh-svc']);

    // An explicit wider window still reaches older spans
    const explicit = await app.inject({
      method: 'GET',
      url: `/api/traces/service-map?from=${encodeURIComponent(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(explicit.statusCode).toBe(200);
    const explicitBody = explicit.json() as { nodes: Array<{ id: string }> };
    expect(explicitBody.nodes.map((n) => n.id).sort()).toEqual(['fresh-svc', 'old-svc']);
  });

  it('GET /api/traces/summary defaults to the last hour when from is omitted (#1528)', async () => {
    await insertSpan({
      id: 'old-root',
      traceId: 'trace-old',
      name: 'GET /old',
      kind: 'server',
      status: 'ok',
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      duration: 100,
      service: 'old-svc',
      source: 'http',
    });

    await insertSpan({
      id: 'fresh-root',
      traceId: 'trace-fresh',
      name: 'GET /fresh',
      kind: 'server',
      status: 'ok',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 100,
      service: 'fresh-svc',
      source: 'http',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/traces/summary',
      headers: { authorization: 'Bearer test' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { totalTraces: number; services: number };
    expect(body.totalTraces).toBe(1);
    expect(body.services).toBe(1);
  });

  it('GET /api/traces/:traceId returns spans preserving snake_case columns, including unset extended attributes (#1545)', async () => {
    await insertSpan({
      id: 'span-root',
      traceId: 'trace-detail',
      name: 'GET /orders',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 42,
      service: 'orders',
      source: 'ebpf',
    });
    await insertSpan({
      id: 'span-child',
      traceId: 'trace-detail',
      parentSpanId: 'span-root',
      name: 'SELECT orders',
      kind: 'internal',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.050Z',
      duration: 10,
      service: 'db',
      source: 'ebpf',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/traces/trace-detail',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { traceId: string; spans: Array<Record<string, unknown>> };
    expect(body.traceId).toBe('trace-detail');
    expect(body.spans).toHaveLength(2);
    expect(body.spans[0].id).toBe('span-root');
    expect(body.spans[0].trace_id).toBe('trace-detail');
    expect(body.spans[0].parent_span_id).toBeNull();
    expect(body.spans[1].parent_span_id).toBe('span-root');
    // The response schema (SpanRowSchema) is a passthrough anchored on a subset
    // of columns — extended-attribute columns insertSpan() didn't set must still
    // be present (as null), not stripped by the serializer's unknown-field pruning.
    expect(body.spans[0]).toHaveProperty('url_scheme');
    expect(body.spans[0].url_scheme).toBeNull();
    expect(body.spans[0]).toHaveProperty('otel_scope_name');
    expect(body.spans[0].otel_scope_name).toBeNull();
  });

  it('GET /api/traces/:traceId returns an empty spans array for an unknown trace id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/traces/does-not-exist',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { traceId: string; spans: unknown[] };
    expect(body.traceId).toBe('does-not-exist');
    expect(body.spans).toEqual([]);
  });

  it('service-map and summary aggregates run under a statement_timeout transaction (#1528)', async () => {
    const executed: string[] = [];
    const realDb = appDb;

    function recordingDb(real: AppDb): AppDb {
      return {
        query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => real.query<T>(sql, params),
        queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => real.queryOne<T>(sql, params),
        execute: (sql: string, params?: unknown[]) => {
          executed.push(sql);
          return real.execute(sql, params);
        },
        transaction: <T>(fn: (db: AppDb) => Promise<T>) => real.transaction<T>((txDb) => fn(recordingDb(txDb))),
        healthCheck: () => real.healthCheck(),
      };
    }

    appDb = recordingDb(realDb);
    try {
      const serviceMap = await app.inject({
        method: 'GET',
        url: '/api/traces/service-map',
        headers: { authorization: 'Bearer test' },
      });
      expect(serviceMap.statusCode).toBe(200);
      expect(executed.some((sql) => sql.includes('SET LOCAL statement_timeout = 10000'))).toBe(true);

      executed.length = 0;
      const summary = await app.inject({
        method: 'GET',
        url: '/api/traces/summary',
        headers: { authorization: 'Bearer test' },
      });
      expect(summary.statusCode).toBe(200);
      expect(executed.some((sql) => sql.includes('SET LOCAL statement_timeout = 10000'))).toBe(true);
    } finally {
      appDb = realDb;
    }
  });
});

// Kept: route imports getDbForDomain directly for trace queries
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));
