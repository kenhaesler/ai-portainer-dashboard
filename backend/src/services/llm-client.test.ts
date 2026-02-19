import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from 'undici';
import { chatStream, isOllamaAvailable, ensureModel, getAuthHeaders, getFetchErrorMessage, getLlmDispatcher, getLlmQueueSize, type LlmAuthType } from './llm-client.js';
import { getEffectiveLlmConfig } from './settings-store.js';

// Mock settings-store
const mockGetConfig = vi.fn().mockReturnValue({
  ollamaUrl: 'http://localhost:11434',
  model: 'llama3.2',
  customEnabled: false,
  customEndpointUrl: undefined,
  customEndpointToken: undefined,
  authType: 'bearer' as LlmAuthType,
  maxTokens: 2048,
  maxToolIterations: 5,
});
vi.mock('./settings-store.js', () => ({
  getEffectiveLlmConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

// Mock config (for getLlmDispatcher)
const mockEnvConfig = vi.fn().mockReturnValue({ LLM_VERIFY_SSL: true, LLM_REQUEST_TIMEOUT: 120000 });
vi.mock('../config/index.js', () => ({
  getConfig: (...args: unknown[]) => mockEnvConfig(...args),
}));

// Mock undici — llmFetch uses undici's fetch (not global fetch) so
// the `dispatcher` option is honored for SSL bypass.
const mockUndiciFetch = vi.fn();
vi.mock('undici', () => ({
  Agent: vi.fn(),
  fetch: (...args: unknown[]) => mockUndiciFetch(...args),
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
        authType: 'bearer' as LlmAuthType,
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

      mockUndiciFetch.mockResolvedValue(
        new Response(mockResponseBody, { status: 200 }),
      );

      const chunks: string[] = [];
      await chatStream(
        [{ role: 'user', content: 'test' }],
        'system prompt',
        (chunk) => chunks.push(chunk),
      );

      // Should call custom endpoint, not Ollama
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
      // Should NOT have Authorization header when token is empty
      const callHeaders = mockUndiciFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBeUndefined();
      // Ollama SDK should NOT have been called
      expect(mockChat).not.toHaveBeenCalled();
      expect(chunks).toContain('Hello');
    });

    it('includes Bearer token when customEndpointToken is set', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: 'my-secret',
        authType: 'bearer' as LlmAuthType,
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

      mockUndiciFetch.mockResolvedValue(
        new Response(mockResponseBody, { status: 200 }),
      );

      await chatStream(
        [{ role: 'user', content: 'test' }],
        'system prompt',
        () => {},
      );

      const callHeaders = mockUndiciFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBe('Bearer my-secret');
    });

    it('strips SSE "data: " prefix from OpenAI-compatible streaming responses', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'gpt-4',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/v1/chat/completions',
        customEndpointToken: 'sk-test',
        authType: 'bearer' as LlmAuthType,
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      // Simulate OpenAI SSE format: "data: {json}\n\ndata: {json}\n\ndata: [DONE]\n\n"
      const ssePayload = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      const mockResponseBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        },
      });

      mockUndiciFetch.mockResolvedValue(
        new Response(mockResponseBody, { status: 200 }),
      );

      const chunks: string[] = [];
      const result = await chatStream(
        [{ role: 'user', content: 'test' }],
        'system prompt',
        (chunk) => chunks.push(chunk),
      );

      expect(result).toBe('Hello world');
      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('handles mixed SSE formats (with and without data: prefix)', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'gpt-4',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/v1/chat/completions',
        customEndpointToken: '',
        authType: 'bearer' as LlmAuthType,
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      // Some APIs send raw NDJSON without data: prefix
      const payload = [
        '{"choices":[{"delta":{"content":"Raw"}}]}',
        'data: {"choices":[{"delta":{"content":" SSE"}}]}',
      ].join('\n');

      const mockResponseBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      });

      mockUndiciFetch.mockResolvedValue(
        new Response(mockResponseBody, { status: 200 }),
      );

      const chunks: string[] = [];
      const result = await chatStream(
        [{ role: 'user', content: 'test' }],
        'system prompt',
        (chunk) => chunks.push(chunk),
      );

      expect(result).toBe('Raw SSE');
      expect(chunks).toEqual(['Raw', ' SSE']);
    });

    it('limits concurrent LLM calls to 2 (queues the rest)', async () => {
      // Reset to default config (Ollama path, not custom endpoint)
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: false,
        customEndpointUrl: '',
        customEndpointToken: '',
        authType: 'bearer' as LlmAuthType,
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      // Each call will block until we resolve its deferred promise
      const resolvers: Array<() => void> = [];
      mockChat.mockImplementation(() => {
        return new Promise<AsyncIterable<{ message: { content: string } }>>((resolve) => {
          resolvers.push(() => {
            resolve((async function* () {
              yield { message: { content: 'ok' } };
            })());
          });
        });
      });

      // Launch 4 calls concurrently
      const results = [
        chatStream([{ role: 'user', content: '1' }], 'sys', vi.fn()),
        chatStream([{ role: 'user', content: '2' }], 'sys', vi.fn()),
        chatStream([{ role: 'user', content: '3' }], 'sys', vi.fn()),
        chatStream([{ role: 'user', content: '4' }], 'sys', vi.fn()),
      ];

      // Wait for microtasks so p-limit schedules the first 2
      await new Promise((r) => setTimeout(r, 50));

      // Only 2 should have started (2 resolvers created)
      expect(resolvers.length).toBe(2);

      // Queue should show 2 pending
      const queue = getLlmQueueSize();
      expect(queue.active).toBe(2);
      expect(queue.pending).toBe(2);

      // Resolve first two
      resolvers[0]();
      resolvers[1]();
      await new Promise((r) => setTimeout(r, 50));

      // Now the next 2 should have started
      expect(resolvers.length).toBe(4);

      // Resolve remaining
      resolvers[2]();
      resolvers[3]();

      // All 4 should complete
      const allResults = await Promise.all(results);
      expect(allResults).toEqual(['ok', 'ok', 'ok', 'ok']);
    });

    it('translates ByteString error to helpful message', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: false,
        customEndpointUrl: '',
        customEndpointToken: '',
        authType: 'bearer' as LlmAuthType,
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
        authType: 'bearer' as LlmAuthType,
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      mockUndiciFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), { status: 200 }),
      );

      const result = await isOllamaAvailable();

      expect(result).toBe(true);
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/models',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns false when custom endpoint is unreachable', async () => {
      mockGetConfig.mockReturnValue({
        ollamaUrl: 'http://localhost:11434',
        model: 'llama3.2',
        customEnabled: true,
        customEndpointUrl: 'http://localhost:3000/api/chat/completions',
        customEndpointToken: '',
        authType: 'bearer' as LlmAuthType,
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      mockUndiciFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await isOllamaAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getAuthHeaders', () => {
    it('returns empty object for undefined/empty token', () => {
      expect(getAuthHeaders(undefined)).toEqual({});
      expect(getAuthHeaders('')).toEqual({});
    });

    it('returns Bearer header for plain token (default authType)', () => {
      expect(getAuthHeaders('sk-my-token')).toEqual({ Authorization: 'Bearer sk-my-token' });
    });

    it('returns Bearer header for colon-containing token with default authType', () => {
      // ParisNeo Ollama Proxy uses "user:token" format with Bearer auth
      expect(getAuthHeaders('myuser:abc123key')).toEqual({ Authorization: 'Bearer myuser:abc123key' });
    });

    it('returns Bearer header when authType is explicitly bearer', () => {
      expect(getAuthHeaders('user:token', 'bearer')).toEqual({ Authorization: 'Bearer user:token' });
    });

    it('returns Basic header when authType is explicitly basic', () => {
      const result = getAuthHeaders('admin:secret', 'basic');
      const expected = Buffer.from('admin:secret').toString('base64');
      expect(result).toEqual({ Authorization: `Basic ${expected}` });
    });

    it('returns Basic header for plain token when authType is basic', () => {
      const result = getAuthHeaders('my-api-key', 'basic');
      const expected = Buffer.from('my-api-key').toString('base64');
      expect(result).toEqual({ Authorization: `Basic ${expected}` });
    });

    it('strips non-Latin1 characters from token to prevent ByteString errors', () => {
      // Simulate a token with invisible Unicode characters (e.g. copy-pasted from web UI)
      const tokenWithUnicode = 'sk-test\u204Akey';
      const result = getAuthHeaders(tokenWithUnicode);
      expect(result).toEqual({ Authorization: 'Bearer sk-testkey' });
    });

    it('returns empty object when token is entirely non-Latin1', () => {
      expect(getAuthHeaders('\u204A\u2050')).toEqual({});
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
        authType: 'bearer' as LlmAuthType,
        maxTokens: 2048,
        maxToolIterations: 5,
      });

      // If it tried to use Ollama, it would call ollama.list() which is mocked
      // but we want to verify it returns immediately without calling Ollama
      await expect(ensureModel()).resolves.toBeUndefined();
    });
  });

  describe('getFetchErrorMessage', () => {
    it('extracts cause message from fetch TypeError', () => {
      const cause = new Error('getaddrinfo ENOTFOUND my-host');
      const err = new TypeError('fetch failed', { cause });
      expect(getFetchErrorMessage(err)).toBe('getaddrinfo ENOTFOUND my-host');
    });

    it('extracts ECONNREFUSED cause', () => {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:8080');
      const err = new TypeError('fetch failed', { cause });
      expect(getFetchErrorMessage(err)).toBe('connect ECONNREFUSED 127.0.0.1:8080');
    });

    it('falls back to error message when no cause', () => {
      const err = new Error('some other error');
      expect(getFetchErrorMessage(err)).toBe('some other error');
    });

    it('returns generic message for non-Error values', () => {
      expect(getFetchErrorMessage('string error')).toBe('Unknown connection error');
      expect(getFetchErrorMessage(null)).toBe('Unknown connection error');
    });
  });

  describe('getLlmDispatcher', () => {
    it('returns undefined when LLM_VERIFY_SSL is true', () => {
      mockEnvConfig.mockReturnValue({ LLM_VERIFY_SSL: true });
      const dispatcher = getLlmDispatcher();
      expect(dispatcher).toBeUndefined();
    });

    it('creates an Agent with rejectUnauthorized: false when LLM_VERIFY_SSL is false (per-connection bypass, not global)', () => {
      // This test verifies the security fix for issue #551:
      // The global process.env.NODE_TLS_REJECT_UNAUTHORIZED override was removed from index.ts.
      // Instead, TLS bypass is applied per-connection via undici Agent, so only LLM connections
      // skip cert validation — all other HTTPS (Portainer, PostgreSQL, etc.) remain protected.
      mockEnvConfig.mockReturnValue({ LLM_VERIFY_SSL: false });
      // llmDispatcher singleton is undefined at this point (previous test returned early).
      const dispatcher = getLlmDispatcher();
      expect(dispatcher).toBeDefined();
      // Verify the Agent was constructed with the per-connection option, not a global override
      expect(Agent).toHaveBeenCalledWith({ connect: { rejectUnauthorized: false } });
      // The global Node.js TLS flag must NOT be set to '0'
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
    });
  });
});
