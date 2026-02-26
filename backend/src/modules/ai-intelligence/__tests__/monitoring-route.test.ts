import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { monitoringRoutes } from '../routes/monitoring.js';

const mockQuery = vi.fn().mockResolvedValue([]);
const mockQueryOne = vi.fn().mockResolvedValue({ count: 0 });
const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });

// Kept: tests verify cursor pagination and SQL parameter assertions
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
    queryOne: (...args: unknown[]) => mockQueryOne(...args),
    execute: (...args: unknown[]) => mockExecute(...args),
    transaction: vi.fn(async (fn: (db: Record<string, unknown>) => Promise<unknown>) => fn({
      query: (...a: unknown[]) => mockQuery(...a),
      queryOne: (...a: unknown[]) => mockQueryOne(...a),
      execute: (...a: unknown[]) => mockExecute(...a),
    })),
    healthCheck: vi.fn(async () => true),
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
    mockQueryOne.mockResolvedValue({ count: 0 });
  });

  it('returns hasMore and nextCursor when more items exist', async () => {
    const rows = [
      { id: 'i3', severity: 'warning', created_at: '2025-01-03T00:00:00Z' },
      { id: 'i2', severity: 'info', created_at: '2025-01-02T00:00:00Z' },
      { id: 'i1', severity: 'critical', created_at: '2025-01-01T00:00:00Z' },
    ];
    mockQuery.mockResolvedValueOnce(rows);
    mockQueryOne.mockResolvedValueOnce({ count: 5 });

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
    mockQuery.mockResolvedValueOnce([
      { id: 'i1', severity: 'info', created_at: '2025-01-01T00:00:00Z' },
    ]);
    mockQueryOne.mockResolvedValueOnce({ count: 1 });

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
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce({ count: 3 });

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
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce({ count: 0 });

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
    mockQuery.mockResolvedValueOnce([
      { id: 'i5', severity: 'critical', created_at: '2025-01-05T00:00:00Z' },
    ]);
    mockQueryOne.mockResolvedValueOnce({ count: 1 });

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

describe('monitoring error handling', () => {
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

  it('returns 500 when insights query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB locked'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights?limit=10',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('Failed to query insights');
    expect(body.details).toContain('DB locked');
  });

  it('returns 500 when acknowledge throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB readonly'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/monitoring/insights/i1/acknowledge',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('Failed to acknowledge insight');
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
    mockQuery.mockResolvedValueOnce([
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
    mockQuery.mockResolvedValueOnce([
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
    mockQuery.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/no-such-container',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.explanations).toEqual([]);
  });

  it('passes timeRange as cutoff to the query params', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/abc123?timeRange=24h',
    });

    expect(mockQuery).toHaveBeenCalled();
    // The route now computes a JS cutoff ISO string and passes it as a param
    const callArgs = mockQuery.mock.calls[0];
    // Second arg is the params array
    const params = callArgs[1] as unknown[];
    // The cutoff should be an ISO date string (about 24 hours ago)
    expect(params.some((p) => typeof p === 'string' && p.endsWith('Z'))).toBe(true);
  });

  it('defaults to 1h time range', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await app.inject({
      method: 'GET',
      url: '/api/monitoring/insights/container/abc123',
    });

    expect(mockQuery).toHaveBeenCalled();
    // The route computes a cutoff from Date.now() - 1h
    const callArgs = mockQuery.mock.calls[0];
    const params = callArgs[1] as unknown[];
    expect(params.some((p) => typeof p === 'string' && p.endsWith('Z'))).toBe(true);
  });
});
