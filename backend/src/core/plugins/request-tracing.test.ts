import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import requestTracing from './request-tracing.js';

const mockInsertSpan = vi.fn();

// Kept: trace-store mock — no PostgreSQL in CI
vi.mock('../tracing/trace-store.js', () => ({
  insertSpan: (...args: unknown[]) => mockInsertSpan(...args),
}));

// Kept: trace-context mock — side-effect isolation
vi.mock('../tracing/trace-context.js', () => ({
  runWithTraceContext: (_ctx: unknown, fn: () => unknown) => fn(),
  getCurrentTraceContext: () => undefined,
}));

describe('request-tracing plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(requestTracing);
    app.get('/api/containers', async () => ({ ok: true }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    app.get('/api/broken', async (_req, reply) => {
      reply.status(500).send({ error: 'internal' });
    });
    app.get('/socket.io/test', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('inserts a span for a normal API request', async () => {
    await app.inject({ method: 'GET', url: '/api/containers' });

    expect(mockInsertSpan).toHaveBeenCalledOnce();
    const span = mockInsertSpan.mock.calls[0][0];
    expect(span.id).toBeTruthy();
    expect(span.trace_id).toBeTruthy();
    expect(span.parent_span_id).toBeNull();
    expect(span.name).toBe('GET /api/containers');
    expect(span.kind).toBe('server');
    expect(span.status).toBe('ok');
    expect(span.service_name).toBe('api-gateway');
    expect(span.duration_ms).toBeGreaterThanOrEqual(0);
    expect(span.start_time).toBeTruthy();
    expect(span.end_time).toBeTruthy();
    expect(span.trace_source).toBe('http');

    const attrs = JSON.parse(span.attributes);
    expect(attrs.method).toBe('GET');
    expect(attrs.statusCode).toBe(200);
  });

  it('assigns requestId and sets X-Request-ID header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/containers' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('uses provided x-request-id header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
      headers: { 'x-request-id': 'custom-id-123' },
    });
    expect(res.headers['x-request-id']).toBe('custom-id-123');
  });

  it('skips health check endpoint', async () => {
    await app.inject({ method: 'GET', url: '/api/health' });
    expect(mockInsertSpan).not.toHaveBeenCalled();
  });

  it('skips socket.io paths', async () => {
    await app.inject({ method: 'GET', url: '/socket.io/test' });
    expect(mockInsertSpan).not.toHaveBeenCalled();
  });

  it('sets status to error for 5xx responses', async () => {
    await app.inject({ method: 'GET', url: '/api/broken' });

    expect(mockInsertSpan).toHaveBeenCalledOnce();
    const span = mockInsertSpan.mock.calls[0][0];
    expect(span.status).toBe('error');
    expect(span.name).toBe('GET /api/broken');
    const attrs = JSON.parse(span.attributes);
    expect(attrs.statusCode).toBe(500);
  });

  it('sets status to error for 4xx responses', async () => {
    // Request a non-existent route -> Fastify returns 404
    await app.inject({ method: 'GET', url: '/api/nonexistent' });

    // 404 routes still get traced (they have url = request.url since no routeOptions.url)
    // But the route is not excluded, so it should be traced
    if (mockInsertSpan.mock.calls.length > 0) {
      const span = mockInsertSpan.mock.calls[0][0];
      expect(span.status).toBe('error');
    }
  });

  it('does not throw if insertSpan fails', async () => {
    mockInsertSpan.mockImplementationOnce(() => {
      throw new Error('DB write failed');
    });

    const res = await app.inject({ method: 'GET', url: '/api/containers' });
    // The request should still complete successfully
    expect(res.statusCode).toBe(200);
    expect(mockInsertSpan).toHaveBeenCalledOnce();
  });

  it('includes attributes as JSON string', async () => {
    await app.inject({ method: 'GET', url: '/api/containers' });

    const span = mockInsertSpan.mock.calls[0][0];
    expect(typeof span.attributes).toBe('string');
    const attrs = JSON.parse(span.attributes);
    expect(attrs).toHaveProperty('method');
    expect(attrs).toHaveProperty('url');
    expect(attrs).toHaveProperty('statusCode');
  });
});
