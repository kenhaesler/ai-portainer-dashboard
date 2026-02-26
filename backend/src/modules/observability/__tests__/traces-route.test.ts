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
    await app.register(async (instance) => {
      instance.decorate('authenticate', async () => undefined);
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
});

// Kept: route imports getDbForDomain directly for trace queries
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));
