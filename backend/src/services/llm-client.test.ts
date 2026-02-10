import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatStream, isOllamaAvailable, ensureModel } from './llm-client.js';
import { getEffectiveLlmConfig } from './settings-store.js';

// Mock settings-store
const mockGetConfig = vi.fn().mockReturnValue({
  ollamaUrl: 'http://localhost:11434',
  model: 'llama3.2',
  customEnabled: false,
  customEndpointUrl: undefined,
  customEndpointToken: undefined,
  maxTokens: 2048,
  maxToolIterations: 5,
});
vi.mock('./settings-store.js', () => ({
  getEffectiveLlmConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

// Mock llm-trace-store
const mockInsertLlmTrace = vi.fn();
vi.mock('./llm-trace-store.js', () => ({
  insertLlmTrace: (...args: unknown[]) => mockInsertLlmTrace(...args),
}));

// Mock Ollama
const mockChat = vi.fn();
vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    chat: mockChat,
    list: vi.fn(),
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

describe('llm-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('chatStream', () => {
    it('records a success trace after streaming completes', async () => {
      // Simulate an async iterable stream that yields two chunks
      const chunks = [
        { message: { content: 'Hello ' } },
        { message: { content: 'world!' } },
      ];
      mockChat.mockResolvedValue((async function* () {
        for (const chunk of chunks) yield chunk;
      })());

      const onChunk = vi.fn();
      const result = await chatStream(
        [{ role: 'user', content: 'Say hello' }],
        'You are a test assistant.',
        onChunk,
      );

      expect(result).toBe('Hello world!');
      expect(onChunk).toHaveBeenCalledTimes(2);

      // Verify trace was recorded
      expect(mockInsertLlmTrace).toHaveBeenCalledTimes(1);
      const trace = mockInsertLlmTrace.mock.calls[0][0];
      expect(trace.model).toBe('llama3.2');
      expect(trace.status).toBe('success');
      expect(trace.user_query).toBe('Say hello');
      expect(trace.response_preview).toBe('Hello world!');
      expect(trace.latency_ms).toBeGreaterThanOrEqual(0);
      expect(trace.prompt_tokens).toBeGreaterThan(0);
      expect(trace.completion_tokens).toBeGreaterThan(0);
      expect(trace.trace_id).toBeDefined();
    });

    it('records an error trace when LLM call fails', async () => {
      mockChat.mockRejectedValue(new Error('Connection refused'));

      const onChunk = vi.fn();
      await expect(
        chatStream(
          [{ role: 'user', content: 'Fail please' }],
          'You are a test assistant.',
          onChunk,
        ),
      ).rejects.toThrow('Connection refused');

      expect(mockInsertLlmTrace).toHaveBeenCalledTimes(1);
      const trace = mockInsertLlmTrace.mock.calls[0][0];
      expect(trace.status).toBe('error');
      expect(trace.user_query).toBe('Fail please');
      expect(trace.response_preview).toContain('Connection refused');
      expect(trace.completion_tokens).toBe(0);
    });

    it('does not fail if trace recording throws', async () => {
      mockInsertLlmTrace.mockImplementation(() => {
        throw new Error('DB write failed');
      });

      const chunks = [{ message: { content: 'ok' } }];
      mockChat.mockResolvedValue((async function* () {
        for (const chunk of chunks) yield chunk;
      })());

      const onChunk = vi.fn();
      const result = await chatStream(
        [{ role: 'user', content: 'test' }],
        'system',
        onChunk,
      );

      // chatStream should still succeed even if trace recording fails
      expect(result).toBe('ok');
    });

    it('uses custom endpoint when customEnabled + url set, even with empty token', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: '',
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      const mockResponseBody = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n',
            ),
          );
          controller.close();
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockResponseBody, { status: 200 }),
      );

      const chunks: string[] = [];
      await chatStream(
        [{ role: 'user', content: 'test' }],
        'system prompt',
        (chunk) => chunks.push(chunk),
      );

      // Should call custom endpoint, not Ollama
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3000/api/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
      // Should NOT have Authorization header when token is empty
      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBeUndefined();
      // Ollama SDK should NOT have been called
      expect(mockChat).not.toHaveBeenCalled();
      expect(chunks).toContain('Hello');

      fetchSpy.mockRestore();
    });

    it('includes Bearer token when customEndpointToken is set', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: 'my-secret',
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      const mockResponseBody = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }) + '\n',
            ),
          );
          controller.close();
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockResponseBody, { status: 200 }),
      );

      await chatStream(
        [{ role: 'user', content: 'test' }],
        'system prompt',
        () => {},
      );

      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBe('Bearer my-secret');

      fetchSpy.mockRestore();
    });

    it('translates ByteString error to helpful message', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: false,
        customEndpointUrl: '',
        customEndpointToken: '',
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      mockChat.mockRejectedValue(
        new Error('Cannot convert argument to a ByteString because the character at index 7 has a value of 8226'),
      );

      await expect(
        chatStream(
          [{ role: 'user', content: 'test' }],
          'system prompt',
          () => {},
        ),
      ).rejects.toThrow(/HTML instead of JSON/);
    });
  });

  describe('isOllamaAvailable', () => {
    it('tests custom endpoint when customEnabled + url set', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: '',
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), { status: 200 }),
      );

      const result = await isOllamaAvailable();

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3000/v1/models',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('returns false when custom endpoint is unreachable', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: '',
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await isOllamaAvailable();
      expect(result).toBe(false);

      vi.restoreAllMocks();
    });
  });

  describe('ensureModel', () => {
    it('skips Ollama model pull when custom endpoint is enabled', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: '',
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      // If it tried to use Ollama, it would call ollama.list() which is mocked
      // but we want to verify it returns immediately without calling Ollama
      await expect(ensureModel()).resolves.toBeUndefined();
    });
  });
});
