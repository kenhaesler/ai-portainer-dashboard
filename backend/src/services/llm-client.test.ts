import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatStream } from './llm-client.js';

// Mock settings-store
vi.mock('./settings-store.js', () => ({
  getEffectiveLlmConfig: vi.fn().mockReturnValue({
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3.2',
    customEnabled: false,
    customEndpointUrl: undefined,
    customEndpointToken: undefined,
  }),
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
  });
});
