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
