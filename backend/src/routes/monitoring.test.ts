import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { monitoringRoutes } from './monitoring.js';

const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue({ count: 0 });
const mockRun = vi.fn().mockReturnValue({ changes: 1 });

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: (...args: unknown[]) => mockAll(...args),
      get: (...args: unknown[]) => mockGet(...args),
      run: (...args: unknown[]) => mockRun(...args),
    }),
  }),
}));

describe('monitoring insights cursor pagination', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(monitoringRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue({ count: 0 });
  });

  it('returns hasMore and nextCursor when more items exist', async () => {
    const rows = [
      { id: 'i3', severity: 'warning', created_at: '2025-01-03T00:00:00Z' },
      { id: 'i2', severity: 'info', created_at: '2025-01-02T00:00:00Z' },
      { id: 'i1', severity: 'critical', created_at: '2025-01-01T00:00:00Z' },
    ];
    mockAll.mockReturnValueOnce(rows);
    mockGet.mockReturnValueOnce({ count: 5 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights?limit=2',
      headers: { authorization: 'Bearer test' },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.insights).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('2025-01-02T00:00:00Z|i2');
    expect(body.total).toBe(5);
  });

  it('returns hasMore=false when fewer results than limit', async () => {
    mockAll.mockReturnValueOnce([
      { id: 'i1', severity: 'info', created_at: '2025-01-01T00:00:00Z' },
    ]);
    mockGet.mockReturnValueOnce({ count: 1 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights?limit=5',
      headers: { authorization: 'Bearer test' },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.insights).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('accepts cursor for next page', async () => {
    mockAll.mockReturnValueOnce([]);
    mockGet.mockReturnValueOnce({ count: 3 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights?limit=2&cursor=2025-01-02T00:00:00Z|i2',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('keeps backward compatible offset pagination', async () => {
    mockAll.mockReturnValueOnce([]);
    mockGet.mockReturnValueOnce({ count: 0 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights?limit=10&offset=20',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.offset).toBe(20);
    expect(body.limit).toBe(10);
    expect(body.total).toBe(0);
  });

  it('filters by severity with cursor', async () => {
    mockAll.mockReturnValueOnce([
      { id: 'i5', severity: 'critical', created_at: '2025-01-05T00:00:00Z' },
    ]);
    mockGet.mockReturnValueOnce({ count: 1 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights?severity=critical&limit=5',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.insights).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('acknowledges an insight', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/monitoring/insights/i1/acknowledge',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
  });
});

describe('GET /api/monitoring/insights/container/:containerId', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(monitoringRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns anomaly explanations for a container', async () => {
    mockAll.mockReturnValueOnce([
      {
        id: 'a1',
        severity: 'critical',
        category: 'anomaly',
        title: 'CPU anomaly detected',
        description: 'CPU at 95%\n\nAI Analysis: CPU spiked due to burst traffic.',
        suggested_action: 'Consider scaling up',
        created_at: '2025-01-01T14:32:00Z',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/abc123?timeRange=1h',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.explanations).toHaveLength(1);
    expect(body.explanations[0].id).toBe('a1');
    expect(body.explanations[0].description).toBe('CPU at 95%');
    expect(body.explanations[0].aiExplanation).toBe('CPU spiked due to burst traffic.');
    expect(body.explanations[0].suggestedAction).toBe('Consider scaling up');
    expect(body.explanations[0].timestamp).toBe('2025-01-01T14:32:00Z');
  });

  it('returns null aiExplanation when no AI analysis in description', async () => {
    mockAll.mockReturnValueOnce([
      {
        id: 'a2',
        severity: 'warning',
        category: 'anomaly',
        title: 'Memory anomaly detected',
        description: 'Memory at 85% (z-score: 3.2)',
        suggested_action: null,
        created_at: '2025-01-01T14:35:00Z',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/abc123?timeRange=1h',
    });

    const body = response.json();
    expect(body.explanations[0].aiExplanation).toBeNull();
    expect(body.explanations[0].description).toBe('Memory at 85% (z-score: 3.2)');
  });

  it('returns empty explanations when no insights exist', async () => {
    mockAll.mockReturnValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/no-such-container',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.explanations).toEqual([]);
  });

  it('passes timeRange as interval to the query', async () => {
    mockAll.mockReturnValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/abc123?timeRange=24h',
    });

    expect(mockAll).toHaveBeenCalled();
    const args = mockAll.mock.calls[0];
    // Third param should be the interval
    expect(args).toContain('-24 hours');
  });

  it('defaults to 1h time range', async () => {
    mockAll.mockReturnValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/abc123',
    });

    expect(mockAll).toHaveBeenCalled();
    const args = mockAll.mock.calls[0];
    expect(args).toContain('-1 hours');
  });
});
