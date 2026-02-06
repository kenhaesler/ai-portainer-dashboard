import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { llmObservabilityRoutes } from './llm-observability.js';

const mockGetRecentTraces = vi.fn();
const mockGetLlmStats = vi.fn();
const mockUpdateFeedback = vi.fn();

vi.mock('../services/llm-trace-store.js', () => ({
  getRecentTraces: (...args: unknown[]) => mockGetRecentTraces(...args),
  getLlmStats: (...args: unknown[]) => mockGetLlmStats(...args),
  updateFeedback: (...args: unknown[]) => mockUpdateFeedback(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('LLM Observability Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
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
      avgFeedbackScore: 4.2,
      feedbackCount: 30,
      modelBreakdown: [{ model: 'llama3.2', count: 80, tokens: 40000 }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/llm/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalQueries).toBe(100);
    expect(body.avgFeedbackScore).toBe(4.2);
  });

  it('POST /api/llm/feedback updates feedback', async () => {
    mockUpdateFeedback.mockReturnValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/llm/feedback',
      payload: { traceId: 'tr-1', score: 5, text: 'Great answer!' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(mockUpdateFeedback).toHaveBeenCalledWith('tr-1', 5, 'Great answer!');
  });

  it('POST /api/llm/feedback validates score range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/llm/feedback',
      payload: { traceId: 'tr-1', score: 10 },
    });

    expect(res.statusCode).toBe(400);
  });
});
