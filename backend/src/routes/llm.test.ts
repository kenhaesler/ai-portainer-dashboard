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
vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockResolvedValue({
      models: [
        { name: 'llama3.2', size: 2_000_000_000, modified_at: '2024-01-01T00:00:00Z' },
        { name: 'codellama', size: 3_000_000_000, modified_at: '2024-02-01T00:00:00Z' },
      ],
    }),
  })),
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
    app = Fastify();
    // Bypass auth
    app.decorate('authenticate', async () => undefined);
    await app.register(llmRoutes);
    await app.ready();
  });

  it('GET /api/llm/models returns available models', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/llm/models',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models).toHaveLength(2);
    expect(body.models[0].name).toBe('llama3.2');
    expect(body.models[1].name).toBe('codellama');
    expect(body.default).toBe('llama3.2');
  });

  it('returns model size and modified date', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/llm/models',
    });

    const body = res.json();
    expect(body.models[0].size).toBe(2_000_000_000);
    expect(body.models[0].modified).toBe('2024-01-01T00:00:00Z');
  });

  it('falls back to default model on error', async () => {
    // Override Ollama mock to throw
    const { Ollama } = await import('ollama');
    vi.mocked(Ollama).mockImplementationOnce(() => ({
      list: vi.fn().mockRejectedValue(new Error('Connection refused')),
    }) as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/llm/models',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].name).toBe('llama3.2');
    expect(body.default).toBe('llama3.2');
  });
});
