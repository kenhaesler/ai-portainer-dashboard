import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { llmObservabilityRoutes } from '../routes/llm-observability.js';

const mockGetRecentTraces = vi.fn();
const mockGetLlmStats = vi.fn();

// Kept: llm-trace-store mock — no PostgreSQL in CI
vi.mock('../services/llm-trace-store.js', () => ({
  getRecentTraces: (...args: unknown[]) => mockGetRecentTraces(...args),
  getLlmStats: (...args: unknown[]) => mockGetLlmStats(...args),
}));

describe('LLM Observability Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(llmObservabilityRoutes);
    await app.ready();
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
});
