import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { settingsRoutes } from './settings.js';

const mockGetUserDefaultLandingPage = vi.fn();
const mockSetUserDefaultLandingPage = vi.fn();
const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue(undefined);
const mockRun = vi.fn().mockReturnValue({ changes: 1 });

vi.mock('../services/user-store.js', () => ({
  getUserDefaultLandingPage: (...args: unknown[]) => mockGetUserDefaultLandingPage(...args),
  setUserDefaultLandingPage: (...args: unknown[]) => mockSetUserDefaultLandingPage(...args),
}));

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: (...args: unknown[]) => mockAll(...args),
      get: (...args: unknown[]) => mockGet(...args),
      run: (...args: unknown[]) => mockRun(...args),
    }),
  }),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

describe('settings preference routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDefaultLandingPage.mockReturnValue('/');
    mockSetUserDefaultLandingPage.mockReturnValue(true);
  });

  it('gets current user landing page preference', async () => {
    mockGetUserDefaultLandingPage.mockReturnValue('/ai-monitor');

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ defaultLandingPage: '/ai-monitor' });
    expect(mockGetUserDefaultLandingPage).toHaveBeenCalledWith('u1');
  });

  it('updates landing page preference for valid route', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
      payload: { defaultLandingPage: '/workloads' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ defaultLandingPage: '/workloads' });
    expect(mockSetUserDefaultLandingPage).toHaveBeenCalledWith('u1', '/workloads');
  });

  it('rejects invalid landing page route', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
      payload: { defaultLandingPage: '/not-a-real-route' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockSetUserDefaultLandingPage).not.toHaveBeenCalled();
  });
});

describe('audit-log cursor pagination', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns hasMore=true and nextCursor when more items exist', async () => {
    // Simulate N+1 rows returned (limit=2 → fetch 3 rows)
    const rows = [
      { id: 3, action: 'login', created_at: '2025-01-03T00:00:00Z' },
      { id: 2, action: 'login', created_at: '2025-01-02T00:00:00Z' },
      { id: 1, action: 'login', created_at: '2025-01-01T00:00:00Z' },
    ];
    mockAll.mockReturnValueOnce(rows);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/audit-log?limit=2',
      headers: { authorization: 'Bearer test' },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.entries).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('2025-01-02T00:00:00Z|2');
  });

  it('returns hasMore=false when no more items', async () => {
    const rows = [
      { id: 2, action: 'login', created_at: '2025-01-02T00:00:00Z' },
    ];
    mockAll.mockReturnValueOnce(rows);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/audit-log?limit=2',
      headers: { authorization: 'Bearer test' },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('accepts cursor parameter for next page', async () => {
    mockAll.mockReturnValueOnce([
      { id: 1, action: 'login', created_at: '2025-01-01T00:00:00Z' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/audit-log?limit=2&cursor=2025-01-02T00:00:00Z|2',
      headers: { authorization: 'Bearer test' },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it('remains backward compatible with offset pagination', async () => {
    mockAll.mockReturnValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/audit-log?limit=10&offset=20',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.offset).toBe(20);
    expect(body.limit).toBe(10);
  });
});

describe('settings security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks non-admin users from GET /api/settings', async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u2', username: 'viewer', sessionId: 's2', role: 'viewer' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Insufficient permissions');

    await app.close();
  });

  it('redacts sensitive values for admin on GET /api/settings', async () => {
    mockAll.mockReturnValueOnce([
      { key: 'oidc.client_secret', value: 'super-secret', category: 'authentication' },
      { key: 'elasticsearch.api_key', value: 'es-key', category: 'logs' },
      { key: 'notifications.smtp_password', value: 'smtp-pass', category: 'notifications' },
      { key: 'notifications.teams_webhook_url', value: 'https://secret.webhook', category: 'notifications' },
      { key: 'llm.custom_endpoint_token', value: 'llm-token', category: 'llm' },
      { key: 'general.theme', value: 'apple-dark', category: 'general' },
    ]);

    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { key: 'oidc.client_secret', value: '••••••••', category: 'authentication' },
      { key: 'elasticsearch.api_key', value: '••••••••', category: 'logs' },
      { key: 'notifications.smtp_password', value: '••••••••', category: 'notifications' },
      { key: 'notifications.teams_webhook_url', value: '••••••••', category: 'notifications' },
      { key: 'llm.custom_endpoint_token', value: '••••••••', category: 'llm' },
      { key: 'general.theme', value: 'apple-dark', category: 'general' },
    ]);

    await app.close();
  });

  it('rejects invalid schemes for security-critical URL settings', async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/llm.ollama_url',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'file:///etc/passwd', category: 'llm' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'llm.ollama_url must use http:// or https://',
    });
    expect(mockRun).not.toHaveBeenCalled();

    await app.close();
  });

  it('accepts valid https URL for oidc.issuer_url', async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/oidc.issuer_url',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'https://auth.example.com', category: 'authentication' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      key: 'oidc.issuer_url',
      value: 'https://auth.example.com',
    });
    expect(mockRun).toHaveBeenCalled();

    await app.close();
  });

  it('preserves existing category when update payload omits category', async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    mockGet.mockReturnValueOnce({ category: 'llm' });

    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/llm.model',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'llama3.2' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRun).toHaveBeenCalledWith(
      'llm.model',
      'llama3.2',
      'llm',
      'llama3.2',
      'llm',
    );

    await app.close();
  });
});
