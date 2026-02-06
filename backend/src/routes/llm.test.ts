import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { llmRoutes } from './llm.js';

// Mock config
vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.2',
  }),
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
