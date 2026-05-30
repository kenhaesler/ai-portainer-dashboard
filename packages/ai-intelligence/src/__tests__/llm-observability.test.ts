import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { llmObservabilityRoutes } from '../routes/llm-observability.js';
import { testAdminOnly, type Role } from '@dashboard/core/test-utils/rbac-test-helper.js';

const mockGetRecentTraces = vi.fn();
const mockGetLlmStats = vi.fn();

// Kept: llm-trace-store mock — no PostgreSQL in CI
vi.mock('../services/llm-trace-store.js', () => ({
  getRecentTraces: (...args: unknown[]) => mockGetRecentTraces(...args),
  getLlmStats: (...args: unknown[]) => mockGetLlmStats(...args),
}));

describe('LLM Observability Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let currentRole: Role = 'admin';

  beforeEach(async () => {
    vi.clearAllMocks();
    currentRole = 'admin';
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: Role) => async (request: any, reply: any) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      (request as any).user = { sub: 'u1', username: 'admin', sessionId: 's1', role: currentRole };
    });
    await app.register(llmObservabilityRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/llm/traces returns recent traces', async () => {
    mockGetRecentTraces.mockReturnValue([
      { id: 1, trace_id: 'tr-1', model: 'llama3.2', total_tokens: 500, status: 'success' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/llm/traces' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].model).toBe('llama3.2');
  });

  it('GET /api/llm/stats returns usage statistics', async () => {
    mockGetLlmStats.mockReturnValue({
      totalQueries: 100,
      totalTokens: 50000,
      avgLatencyMs: 1200,
      errorRate: 2.5,
      modelBreakdown: [{ model: 'llama3.2', count: 80, tokens: 40000 }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/llm/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalQueries).toBe(100);
    expect(body.modelBreakdown).toHaveLength(1);
  });

  describe('RBAC', () => {
    testAdminOnly(() => app, (r) => { currentRole = r; }, 'GET', '/api/llm/traces');
    testAdminOnly(() => app, (r) => { currentRole = r; }, 'GET', '/api/llm/stats');
  });
});
