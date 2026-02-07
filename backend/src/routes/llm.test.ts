import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { llmRoutes } from './llm.js';

// Mock settings-store (getEffectiveLlmConfig)
vi.mock('../services/settings-store.js', () => ({
  getEffectiveLlmConfig: vi.fn().mockReturnValue({
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3.2',
    customEnabled: false,
    customEndpointUrl: undefined,
    customEndpointToken: undefined,
  }),
  getSetting: vi.fn().mockReturnValue(undefined),
}));

// Mock llm-trace-store
const mockInsertLlmTrace = vi.fn();
vi.mock('../services/llm-trace-store.js', () => ({
  insertLlmTrace: (...args: unknown[]) => mockInsertLlmTrace(...args),
}));

// Mock Ollama
const mockChat = vi.fn();
const mockList = vi.fn();
vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    chat: mockChat,
    list: mockList,
  })),
}));

// Mock portainer
vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/portainer-normalizers.js', () => ({
  normalizeEndpoint: vi.fn((ep: any) => ep),
  normalizeContainer: vi.fn((c: any) => c),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetch: vi.fn().mockResolvedValue([]),
  getCacheKey: vi.fn((...args: any[]) => args.join(':')),
  TTL: { ENDPOINTS: 60, CONTAINERS: 30 },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('LLM Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(llmRoutes);
    await app.ready();
  });

  describe('GET /api/llm/models', () => {
    it('returns available models', async () => {
      mockList.mockResolvedValue({
        models: [
          { name: 'llama3.2', size: 2_000_000_000, modified_at: '2024-01-01T00:00:00Z' },
          { name: 'codellama', size: 3_000_000_000, modified_at: '2024-02-01T00:00:00Z' },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/models',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.models).toHaveLength(2);
      expect(body.models[0].name).toBe('llama3.2');
      expect(body.default).toBe('llama3.2');
    });

    it('returns model size and modified date', async () => {
      mockList.mockResolvedValue({
        models: [
          { name: 'llama3.2', size: 2_000_000_000, modified_at: '2024-01-01T00:00:00Z' },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/models',
      });

      const body = res.json();
      expect(body.models[0].size).toBe(2_000_000_000);
      expect(body.models[0].modified).toBe('2024-01-01T00:00:00Z');
    });

    it('falls back to default model on error', async () => {
      mockList.mockRejectedValue(new Error('Connection refused'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/models',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.models).toHaveLength(1);
      expect(body.models[0].name).toBe('llama3.2');
    });
  });

  describe('POST /api/llm/test-connection', () => {
    it('returns ok with models when Ollama connection succeeds', async () => {
      mockList.mockResolvedValue({
        models: [
          { name: 'llama3.2', size: 2_000_000_000, modified_at: '2024-01-01T00:00:00Z' },
          { name: 'mistral', size: 4_000_000_000, modified_at: '2024-03-01T00:00:00Z' },
        ],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/test-connection',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.models).toHaveLength(2);
      expect(body.models).toContain('llama3.2');
      expect(body.models).toContain('mistral');
    });

    it('returns error when Ollama connection fails', async () => {
      mockList.mockRejectedValue(new Error('Connection refused'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/test-connection',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Connection refused');
    });

    it('accepts empty object body gracefully', async () => {
      mockList.mockResolvedValue({ models: [] });

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/test-connection',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.models).toEqual([]);
    });

    it('uses ollamaUrl when provided', async () => {
      const { Ollama } = await import('ollama');
      mockList.mockResolvedValue({
        models: [{ name: 'gemma2', size: 5_000_000_000, modified_at: '2024-04-01T00:00:00Z' }],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/test-connection',
        payload: { ollamaUrl: 'http://custom-ollama:11434' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.models).toContain('gemma2');
      // Verify Ollama was instantiated with the custom host
      expect(Ollama).toHaveBeenCalledWith({ host: 'http://custom-ollama:11434' });
    });
  });

  describe('POST /api/llm/query', () => {
    it('returns navigate action for navigation queries', async () => {
      mockChat.mockResolvedValue({
        message: { content: JSON.stringify({ action: 'navigate', page: '/workloads', description: 'View all containers' }) },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/query',
        payload: { query: 'show me all running containers' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe('navigate');
      expect(body.page).toBe('/workloads');
    });

    it('returns answer action for factual queries', async () => {
      mockChat.mockResolvedValue({
        message: { content: JSON.stringify({ action: 'answer', text: '47 containers are running', description: 'Based on current data' }) },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/query',
        payload: { query: 'how many containers are running?' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe('answer');
      expect(body.text).toBe('47 containers are running');
    });

    it('returns error on LLM failure', async () => {
      mockChat.mockRejectedValue(new Error('LLM unavailable'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/query',
        payload: { query: 'what is happening?' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe('error');
    });

    it('records a success trace after successful query', async () => {
      mockChat.mockResolvedValue({
        message: { content: JSON.stringify({ action: 'answer', text: 'hello', description: 'test' }) },
      });

      await app.inject({
        method: 'POST',
        url: '/api/llm/query',
        payload: { query: 'test query for tracing' },
      });

      expect(mockInsertLlmTrace).toHaveBeenCalledTimes(1);
      const trace = mockInsertLlmTrace.mock.calls[0][0];
      expect(trace.model).toBe('llama3.2');
      expect(trace.status).toBe('success');
      expect(trace.user_query).toBe('test query for tracing');
      expect(trace.latency_ms).toBeGreaterThanOrEqual(0);
      expect(trace.prompt_tokens).toBeGreaterThan(0);
      expect(trace.trace_id).toBeDefined();
    });

    it('records an error trace on LLM failure', async () => {
      mockChat.mockRejectedValue(new Error('Connection refused'));

      await app.inject({
        method: 'POST',
        url: '/api/llm/query',
        payload: { query: 'failing query' },
      });

      expect(mockInsertLlmTrace).toHaveBeenCalledTimes(1);
      const trace = mockInsertLlmTrace.mock.calls[0][0];
      expect(trace.status).toBe('error');
      expect(trace.user_query).toBe('failing query');
      expect(trace.response_preview).toContain('Connection refused');
    });

    it('validates query minimum length', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/query',
        payload: { query: 'a' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
