import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { tracesRoutes } from './traces.js';

const db = new Database(':memory:');

function insertSpan(span: {
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
}) {
  db.prepare(`
    INSERT INTO spans (
      id, trace_id, parent_span_id, name, kind, status,
      start_time, end_time, duration_ms, service_name, attributes, trace_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
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
    '{}',
    span.source,
  );
}

beforeAll(() => {
  db.exec(`
    CREATE TABLE spans (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_ms INTEGER,
      service_name TEXT NOT NULL,
      attributes TEXT DEFAULT '{}',
      trace_source TEXT DEFAULT 'http',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  db.exec('DELETE FROM spans');
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

  it('GET /api/traces/service-map uses filtered time range and source', async () => {
    insertSpan({
      id: 'root-old',
      traceId: 'trace-old',
      name: 'GET /old',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-10T10:00:00.000Z',
      duration: 100,
      service: 'api',
      source: 'http',
    });

    insertSpan({
      id: 'root-new',
      traceId: 'trace-new',
      name: 'GET /users',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 300,
      service: 'api',
      source: 'ebpf',
    });

    insertSpan({
      id: 'child-new',
      traceId: 'trace-new',
      parentSpanId: 'root-new',
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

  it('GET /api/traces/summary uses provided from/to window', async () => {
    insertSpan({
      id: 'sum-1',
      traceId: 'trace-1',
      name: 'GET /a',
      kind: 'server',
      status: 'ok',
      startTime: '2026-02-11T10:00:00.000Z',
      duration: 50,
      service: 'svc-a',
      source: 'ebpf',
    });

    insertSpan({
      id: 'sum-2',
      traceId: 'trace-2',
      name: 'GET /b',
      kind: 'server',
      status: 'error',
      startTime: '2026-02-12T10:00:00.000Z',
      duration: 200,
      service: 'svc-b',
      source: 'ebpf',
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
    };

    expect(body.totalTraces).toBe(1);
    expect(body.avgDuration).toBe(200);
    expect(body.errorRate).toBe(1);
    expect(body.services).toBe(1);
  });
});

vi.mock('../db/sqlite.js', () => ({
  getDb: () => db,
}));
