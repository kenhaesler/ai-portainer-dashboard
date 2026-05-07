import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { Agent } from 'undici';
import {
  chatStream,
  isLlmAvailable,
  getAuthHeaders,
  getFetchErrorMessage,
  getLlmDispatcher,
  getLlmQueueSize,
  extractApiError,
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  type LlmAuthType,
} from '../services/llm-client.js';

// Default LLM config used by tests — configured for the OpenAI-compatible API.
const DEFAULT_LLM_CONFIG = {
  apiUrl: 'http://localhost:3000/v1/chat/completions',
  apiToken: '',
  model: 'gpt-4o-mini',
  authType: 'bearer' as LlmAuthType,
  maxTokens: 2048,
  maxToolIterations: 5,
};

const mockGetConfig = vi.fn().mockReturnValue({ ...DEFAULT_LLM_CONFIG });
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveLlmConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

// Tests control fetch via undici (the real client uses undici dispatcher).
const mockUndiciFetch = vi.fn();
vi.mock('undici', () => ({
  Agent: vi.fn(),
  fetch: (...args: unknown[]) => mockUndiciFetch(...args),
}));

const mockInsertLlmTrace = vi.fn();
vi.mock('../services/llm-trace-store.js', () => ({
  insertLlmTrace: (...args: unknown[]) => mockInsertLlmTrace(...args),
}));

describe('llm-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG });
    setConfigForTest({ LLM_VERIFY_SSL: true, LLM_REQUEST_TIMEOUT: 120000 });
  });

  afterEach(() => {
    resetConfig();
  });

  describe('chatStream', () => {
    function mockSseResponse(payload: string) {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      });
      mockUndiciFetch.mockResolvedValue(new Response(body, { status: 200 }));
    }

    it('streams via the configured API URL and records a success trace', async () => {
      mockSseResponse(JSON.stringify({ choices: [{ delta: { content: 'Hello world' } }] }) + '\n');

      const onChunk = vi.fn();
      const result = await chatStream(
        [{ role: 'user', content: 'Say hello' }],
        'You are a test assistant.',
        onChunk,
      );

      expect(result).toBe('Hello world');
      expect(onChunk).toHaveBeenCalledWith('Hello world');
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );

      expect(mockInsertLlmTrace).toHaveBeenCalledTimes(1);
      const trace = mockInsertLlmTrace.mock.calls[0][0];
      expect(trace.status).toBe('success');
      expect(trace.user_query).toBe('Say hello');
      expect(trace.response_preview).toBe('Hello world');
    });

    it('throws when no API URL is configured', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiUrl: '' });
      await expect(
        chatStream([{ role: 'user', content: 'hi' }], 'system', () => {}),
      ).rejects.toThrow(/LLM is not configured/);
    });

    it('records an error trace when LLM call fails', async () => {
      mockUndiciFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(
        chatStream([{ role: 'user', content: 'test' }], 'system', () => {}),
      ).rejects.toThrow();

      expect(mockInsertLlmTrace).toHaveBeenCalledTimes(1);
      const trace = mockInsertLlmTrace.mock.calls[0][0];
      expect(trace.status).toBe('error');
    });

    it('still returns response when trace recording fails', async () => {
      mockSseResponse(JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n');
      mockInsertLlmTrace.mockRejectedValue(new Error('DB down'));

      const result = await chatStream([{ role: 'user', content: 'test' }], 'system', () => {});
      expect(result).toBe('ok');
    });

    it('omits Authorization header when no token configured', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiToken: '' });
      mockSseResponse(JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n');

      await chatStream([{ role: 'user', content: 'test' }], 'system', () => {});

      const headers = mockUndiciFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('includes Bearer token when apiToken is set', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiToken: 'my-secret' });
      mockSseResponse(JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n');

      await chatStream([{ role: 'user', content: 'test' }], 'system', () => {});

      const headers = mockUndiciFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-secret');
    });

    it('strips SSE "data: " prefix from OpenAI-compatible streaming responses', async () => {
      const ssePayload = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');
      mockSseResponse(ssePayload);

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
      const payload = [
        '{"choices":[{"delta":{"content":"Raw"}}]}',
        'data: {"choices":[{"delta":{"content":" SSE"}}]}',
      ].join('\n');
      mockSseResponse(payload);

      const result = await chatStream([{ role: 'user', content: 'test' }], 'system', () => {});
      expect(result).toBe('Raw SSE');
    });

    it('auto-appends /v1/chat/completions when user enters a bare base URL', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiUrl: 'http://192.168.1.10:1234' });
      mockSseResponse(JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n');

      await chatStream([{ role: 'user', content: 'hi' }], 'system', () => {});

      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'http://192.168.1.10:1234/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('surfaces API error response from LM-Studio-style 200-with-error body', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiUrl: 'http://192.168.1.10:1234' });
      mockSseResponse(JSON.stringify({ error: 'Unexpected endpoint or method. (POST /)' }));

      await expect(
        chatStream([{ role: 'user', content: 'hi' }], 'system', () => {}),
      ).rejects.toThrow(/Unexpected endpoint or method/);
    });

    it('surfaces structured OpenAI-style error object ({error: {message}})', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiToken: 'sk-bad' });
      mockSseResponse(
        JSON.stringify({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }),
      );

      await expect(
        chatStream([{ role: 'user', content: 'hi' }], 'system', () => {}),
      ).rejects.toThrow(/Invalid API key/);
    });

    it('limits concurrent LLM calls to 2 (queues the rest)', async () => {
      // Each call holds the body reader open until we resolve the deferred.
      const resolvers: Array<() => void> = [];
      mockUndiciFetch.mockImplementation(() => {
        return new Promise((resolve) => {
          resolvers.push(() => {
            const body = new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n'),
                );
                controller.close();
              },
            });
            resolve(new Response(body, { status: 200 }));
          });
        });
      });

      const results = [
        chatStream([{ role: 'user', content: '1' }], 'sys', vi.fn()),
        chatStream([{ role: 'user', content: '2' }], 'sys', vi.fn()),
        chatStream([{ role: 'user', content: '3' }], 'sys', vi.fn()),
        chatStream([{ role: 'user', content: '4' }], 'sys', vi.fn()),
      ];

      await new Promise((r) => setTimeout(r, 50));
      expect(resolvers.length).toBe(2);

      const queue = getLlmQueueSize();
      expect(queue.active).toBe(2);
      expect(queue.pending).toBe(2);

      resolvers[0]();
      resolvers[1]();
      await new Promise((r) => setTimeout(r, 50));
      expect(resolvers.length).toBe(4);

      resolvers[2]();
      resolvers[3]();

      const allResults = await Promise.all(results);
      expect(allResults).toEqual(['ok', 'ok', 'ok', 'ok']);
    });
  });

  describe('isLlmAvailable', () => {
    it('returns true when /v1/models responds with 2xx', async () => {
      mockUndiciFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), { status: 200 }),
      );

      const result = await isLlmAvailable();

      expect(result).toBe(true);
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/models',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns false when endpoint is unreachable', async () => {
      mockUndiciFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await isLlmAvailable()).toBe(false);
    });

    it('returns false when no API URL is configured', async () => {
      mockGetConfig.mockReturnValue({ ...DEFAULT_LLM_CONFIG, apiUrl: '' });
      expect(await isLlmAvailable()).toBe(false);
    });
  });

  describe('resolveChatCompletionsUrl', () => {
    it('appends /v1/chat/completions to a bare base URL', () => {
      expect(resolveChatCompletionsUrl('http://192.168.1.10:1234')).toBe(
        'http://192.168.1.10:1234/v1/chat/completions',
      );
    });

    it('strips trailing slash before appending', () => {
      expect(resolveChatCompletionsUrl('http://lmstudio:1234/')).toBe(
        'http://lmstudio:1234/v1/chat/completions',
      );
    });

    it('appends /chat/completions when URL ends with /v1', () => {
      expect(resolveChatCompletionsUrl('http://api.example.com/v1')).toBe(
        'http://api.example.com/v1/chat/completions',
      );
    });

    it('leaves a full /v1/chat/completions URL unchanged', () => {
      expect(resolveChatCompletionsUrl('http://localhost:3000/v1/chat/completions')).toBe(
        'http://localhost:3000/v1/chat/completions',
      );
    });

    it('leaves a non-standard /api/chat/completions URL unchanged (Open WebUI)', () => {
      expect(resolveChatCompletionsUrl('http://localhost:3000/api/chat/completions')).toBe(
        'http://localhost:3000/api/chat/completions',
      );
    });

    it('preserves reverse-proxy path prefix when appending', () => {
      expect(resolveChatCompletionsUrl('https://gateway.example.com/llm-proxy')).toBe(
        'https://gateway.example.com/llm-proxy/v1/chat/completions',
      );
    });

    it('returns empty string for empty input', () => {
      expect(resolveChatCompletionsUrl('')).toBe('');
      expect(resolveChatCompletionsUrl('   ')).toBe('');
    });

    it('trims surrounding whitespace', () => {
      expect(resolveChatCompletionsUrl('  http://lmstudio:1234  ')).toBe(
        'http://lmstudio:1234/v1/chat/completions',
      );
    });
  });

  describe('resolveModelsUrl', () => {
    it('replaces /chat/completions with /models', () => {
      expect(resolveModelsUrl('http://localhost:3000/v1/chat/completions')).toBe(
        'http://localhost:3000/v1/models',
      );
    });

    it('appends /v1/models to a bare base URL', () => {
      expect(resolveModelsUrl('http://lmstudio:1234')).toBe('http://lmstudio:1234/v1/models');
    });

    it('handles Open WebUI /api/chat/completions', () => {
      expect(resolveModelsUrl('http://localhost:3000/api/chat/completions')).toBe(
        'http://localhost:3000/api/models',
      );
    });
  });

  describe('extractApiError', () => {
    it('returns null for non-objects', () => {
      expect(extractApiError(null)).toBeNull();
      expect(extractApiError('string')).toBeNull();
      expect(extractApiError(42)).toBeNull();
    });

    it('returns null for objects without an error field', () => {
      expect(extractApiError({})).toBeNull();
      expect(extractApiError({ choices: [{ delta: { content: 'hi' } }] })).toBeNull();
    });

    it('extracts string-shaped error', () => {
      expect(extractApiError({ error: 'Unexpected endpoint or method. (POST /)' })).toBe(
        'Unexpected endpoint or method. (POST /)',
      );
    });

    it('extracts message from object-shaped error', () => {
      expect(
        extractApiError({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }),
      ).toBe('Invalid API key');
    });

    it('falls back to JSON-stringified object when no message field', () => {
      const result = extractApiError({ error: { code: 500, type: 'server_error' } });
      expect(result).toContain('server_error');
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
      expect(getAuthHeaders('myuser:abc123key')).toEqual({ Authorization: 'Bearer myuser:abc123key' });
    });

    it('returns Basic header when authType is explicitly basic', () => {
      const result = getAuthHeaders('admin:secret', 'basic');
      const expected = Buffer.from('admin:secret').toString('base64');
      expect(result).toEqual({ Authorization: `Basic ${expected}` });
    });

    it('strips non-Latin1 characters from token to prevent ByteString errors', () => {
      const tokenWithUnicode = 'sk-test⁊key';
      const result = getAuthHeaders(tokenWithUnicode);
      expect(result).toEqual({ Authorization: 'Bearer sk-testkey' });
    });

    it('returns empty object when token is entirely non-Latin1', () => {
      expect(getAuthHeaders('⁊⁐')).toEqual({});
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
      expect(getFetchErrorMessage(new Error('some error'))).toBe('some error');
    });

    it('returns generic message for non-Error values', () => {
      expect(getFetchErrorMessage('string error')).toBe('Unknown connection error');
      expect(getFetchErrorMessage(null)).toBe('Unknown connection error');
    });
  });

  describe('getLlmDispatcher', () => {
    it('returns undefined when LLM_VERIFY_SSL is true', () => {
      setConfigForTest({ LLM_VERIFY_SSL: true });
      const dispatcher = getLlmDispatcher();
      expect(dispatcher).toBeUndefined();
    });

    it('creates an Agent with rejectUnauthorized: false when LLM_VERIFY_SSL is false', () => {
      setConfigForTest({ LLM_VERIFY_SSL: false });
      const dispatcher = getLlmDispatcher();
      expect(dispatcher).toBeDefined();
      expect(Agent).toHaveBeenCalledWith({ connect: { rejectUnauthorized: false } });
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
    });
  });
});
