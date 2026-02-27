import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { testAdminOnly } from '../test-utils/rbac-test-helper.js';
import { settingsRoutes } from './settings.js';

const mockQueryOneUserDefaultLandingPage = vi.fn();
const mockSetUserDefaultLandingPage = vi.fn();
const mockQuery = vi.fn().mockResolvedValue([]);
const mockQueryOne = vi.fn().mockResolvedValue(null);
const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });

vi.mock('@dashboard/core/services/user-store.js', () => ({
  getUserDefaultLandingPage: (...args: unknown[]) => mockQueryOneUserDefaultLandingPage(...args),
  setUserDefaultLandingPage: (...args: unknown[]) => mockSetUserDefaultLandingPage(...args),
}));

// Kept: complex multi-service mock interaction (user-store, prompt-store, audit-logger)
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

vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

const mockCreatePromptVersion = vi.fn().mockResolvedValue({ id: 1, version: 1 });
const mockGetPromptHistory = vi.fn().mockResolvedValue([]);
const mockGetPromptVersionById = vi.fn().mockResolvedValue(null);

vi.mock('@dashboard/ai', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  const defaults: Record<string, string> = {
    chat_assistant: 'You are a helpful assistant.',
    anomaly_explainer: 'You are an anomaly explainer.',
  };
  return {
    ...orig,
    PROMPT_FEATURES: [
      { key: 'chat_assistant', label: 'Chat Assistant', description: 'Main AI chat' },
      { key: 'anomaly_explainer', label: 'Anomaly Explainer', description: 'Explains anomalies' },
    ],
    DEFAULT_PROMPTS: defaults,
    getEffectivePrompt: (feature: string) => defaults[feature] ?? '',
    createPromptVersion: (...args: unknown[]) => mockCreatePromptVersion(...args),
    getPromptHistory: (...args: unknown[]) => mockGetPromptHistory(...args),
    getPromptVersionById: (...args: unknown[]) => mockGetPromptVersionById(...args),
  };
});

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
    mockQueryOneUserDefaultLandingPage.mockReturnValue('/');
    mockSetUserDefaultLandingPage.mockReturnValue(true);
  });

  it('gets current user landing page preference', async () => {
    mockQueryOneUserDefaultLandingPage.mockReturnValue('/ai-monitor');

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ defaultLandingPage: '/ai-monitor' });
    expect(mockQueryOneUserDefaultLandingPage).toHaveBeenCalledWith('u1');
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
    mockQuery.mockResolvedValueOnce(rows);

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
    mockQuery.mockResolvedValueOnce(rows);

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
    mockQuery.mockResolvedValueOnce([
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
    mockQuery.mockResolvedValueOnce([]);

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
  let secApp: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    secApp = Fastify({ logger: false });
    secApp.setValidatorCompiler(validatorCompiler);
    secApp.decorate('authenticate', async () => undefined);
    secApp.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    secApp.decorateRequest('user', undefined);
    secApp.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: currentRole };
    });
    await secApp.register(settingsRoutes);
    await secApp.ready();
  });

  afterAll(async () => {
    await secApp.close();
  });

  beforeEach(() => {
    currentRole = 'admin';
    vi.clearAllMocks();
  });

  testAdminOnly(() => secApp, (r) => { currentRole = r; }, 'GET', '/api/settings');

  it('redacts sensitive values for admin on GET /api/settings', async () => {
    mockQuery.mockResolvedValueOnce([
      { key: 'oidc.client_secret', value: 'super-secret', category: 'authentication' },
      { key: 'elasticsearch.api_key', value: 'es-key', category: 'logs' },
      { key: 'notifications.smtp_password', value: 'smtp-pass', category: 'notifications' },
      { key: 'notifications.teams_webhook_url', value: 'https://secret.webhook', category: 'notifications' },
      { key: 'llm.custom_endpoint_token', value: 'llm-token', category: 'llm' },
      { key: 'general.theme', value: 'apple-dark', category: 'general' },
    ]);

    const response = await secApp.inject({
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
    expect(mockExecute).not.toHaveBeenCalled();

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
    expect(mockExecute).toHaveBeenCalled();

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
    mockQueryOne.mockResolvedValueOnce({ category: 'llm' });

    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/llm.model',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'llama3.2' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      ['llm.model', 'llama3.2', 'llm', 'llama3.2', 'llm'],
    );

    await app.close();
  });
});

describe('prompt-features endpoint', () => {
  let pfApp: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    pfApp = Fastify({ logger: false });
    pfApp.setValidatorCompiler(validatorCompiler);
    pfApp.decorate('authenticate', async () => undefined);
    pfApp.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    pfApp.decorateRequest('user', undefined);
    pfApp.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: currentRole };
    });
    await pfApp.register(settingsRoutes);
    await pfApp.ready();
  });

  afterAll(async () => {
    await pfApp.close();
  });

  beforeEach(() => {
    currentRole = 'admin';
  });

  it('returns feature definitions with default prompts', async () => {
    const response = await pfApp.inject({
      method: 'GET',
      url: '/api/settings/prompt-features',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.features).toHaveLength(2);
    expect(body.features[0]).toEqual({
      key: 'chat_assistant',
      label: 'Chat Assistant',
      description: 'Main AI chat',
      defaultPrompt: 'You are a helpful assistant.',
      effectivePrompt: 'You are a helpful assistant.',
    });
    expect(body.features[1]).toEqual({
      key: 'anomaly_explainer',
      label: 'Anomaly Explainer',
      description: 'Explains anomalies',
      defaultPrompt: 'You are an anomaly explainer.',
      effectivePrompt: 'You are an anomaly explainer.',
    });
  });

  testAdminOnly(() => pfApp, (r) => { currentRole = r; }, 'GET', '/api/settings/prompt-features');
});

describe('prompt version history routes (#415)', () => {
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
    mockCreatePromptVersion.mockResolvedValue({ id: 1, version: 1 });
    mockGetPromptHistory.mockResolvedValue([]);
    mockGetPromptVersionById.mockResolvedValue(null);
  });

  // ── GET history ─────────────────────────────────────────────────────

  it('GET /api/settings/prompts/:feature/history returns version list', async () => {
    const versions = [
      { id: 2, feature: 'chat_assistant', version: 2, systemPrompt: 'New prompt', model: null, temperature: null, changedBy: 'admin', changedAt: '2026-01-02T00:00:00Z', changeNote: null },
      { id: 1, feature: 'chat_assistant', version: 1, systemPrompt: 'Old prompt', model: null, temperature: null, changedBy: 'system', changedAt: '2026-01-01T00:00:00Z', changeNote: null },
    ];
    mockGetPromptHistory.mockResolvedValueOnce(versions);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/prompts/chat_assistant/history',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().versions).toHaveLength(2);
    expect(response.json().versions[0].version).toBe(2);
    expect(response.json().versions[1].version).toBe(1);
  });

  it('returns 404 for unknown feature', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/prompts/not_a_feature/history',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatch(/unknown feature/i);
  });

  it('returns empty versions list when no history exists', async () => {
    mockGetPromptHistory.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/prompts/anomaly_explainer/history',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().versions).toEqual([]);
  });

  // ── POST rollback ────────────────────────────────────────────────────

  it('POST rollback restores prompt and creates new version', async () => {
    const targetVersion = {
      id: 1,
      feature: 'chat_assistant',
      version: 1,
      systemPrompt: 'Old reliable prompt.',
      model: null,
      temperature: null,
      changedBy: 'system',
      changedAt: '2026-01-01T00:00:00Z',
      changeNote: null,
    };
    mockGetPromptVersionById.mockResolvedValueOnce(targetVersion);
    mockCreatePromptVersion.mockResolvedValueOnce({ id: 3, version: 3 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/prompts/chat_assistant/rollback',
      headers: { authorization: 'Bearer test' },
      payload: { versionId: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(response.json().newVersion.version).toBe(3);

    // Verify the settings table was updated with the rolled-back prompt
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      expect.arrayContaining(['prompts.chat_assistant.system_prompt', 'Old reliable prompt.']),
    );

    // Verify a new version was recorded for the rollback
    expect(mockCreatePromptVersion).toHaveBeenCalledWith(
      'chat_assistant',
      'Old reliable prompt.',
      'admin',
      expect.objectContaining({ changeNote: expect.stringContaining('v1') }),
    );
  });

  it('POST rollback returns 404 for unknown feature', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/prompts/unknown_feature/rollback',
      headers: { authorization: 'Bearer test' },
      payload: { versionId: 1 },
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST rollback returns 404 when target version not found', async () => {
    mockGetPromptVersionById.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/prompts/chat_assistant/rollback',
      headers: { authorization: 'Bearer test' },
      payload: { versionId: 9999 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Version not found');
  });

  // ── Auto-version on PUT /api/settings/:key ──────────────────────────

  it('auto-creates a version when a system_prompt setting is saved', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing setting
    mockExecute.mockResolvedValue({ changes: 1 });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/prompts.chat_assistant.system_prompt',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'New improved prompt.', category: 'prompts' },
    });

    expect(response.statusCode).toBe(200);
    // Wait for the fire-and-forget version creation
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockCreatePromptVersion).toHaveBeenCalledWith(
      'chat_assistant',
      'New improved prompt.',
      'admin',
    );
  });

  it('does NOT auto-create a version for non-prompt settings', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockExecute.mockResolvedValue({ changes: 1 });

    await app.inject({
      method: 'PUT',
      url: '/api/settings/llm.model',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'llama3.2', category: 'llm' },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockCreatePromptVersion).not.toHaveBeenCalled();
  });
});
