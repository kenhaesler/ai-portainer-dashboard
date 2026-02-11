import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Hoisted mock references (available inside vi.mock factories) ──

const {
  mockOllamaChat,
  mockParseToolCalls,
  mockCollectAllTools,
  mockRouteToolCalls,
  mockGetEffectiveLlmConfig,
} = vi.hoisted(() => ({
  mockOllamaChat: vi.fn(),
  mockParseToolCalls: vi.fn(),
  mockCollectAllTools: vi.fn(),
  mockRouteToolCalls: vi.fn(),
  mockGetEffectiveLlmConfig: vi.fn(),
}));

// ── Module mocks ──

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    chat: mockOllamaChat,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: vi.fn().mockResolvedValue([]),
  getContainers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/portainer-normalizers.js', () => ({
  normalizeEndpoint: vi.fn((e: any) => e),
  normalizeContainer: vi.fn((c: any) => c),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetch: vi.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  getCacheKey: vi.fn((...args: string[]) => args.join(':')),
  TTL: { ENDPOINTS: 60, CONTAINERS: 60 },
}));

vi.mock('../db/sqlite.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
  })),
}));

vi.mock('../services/llm-trace-store.js', () => ({
  insertLlmTrace: vi.fn(),
}));

vi.mock('../services/llm-tools.js', () => ({
  getToolSystemPrompt: vi.fn(() => ''),
  parseToolCalls: mockParseToolCalls,
  executeToolCalls: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/mcp-tool-bridge.js', () => ({
  collectAllTools: mockCollectAllTools,
  routeToolCalls: mockRouteToolCalls,
  getMcpToolPrompt: vi.fn(() => ''),
}));

vi.mock('../services/settings-store.js', () => ({
  getEffectiveLlmConfig: mockGetEffectiveLlmConfig,
}));

vi.mock('../services/prompt-store.js', () => ({
  getEffectivePrompt: vi.fn(() => 'You are an AI assistant.'),
}));

// ── Import the module under test AFTER mocks are registered ──
import {
  isRecoverableToolCallParseError,
  looksLikeToolCallAttempt,
  formatChatContext,
  setupLlmNamespace,
} from './llm-chat.js';
import { getAuthHeaders } from '../services/llm-client.js';

// ── Pure utility function tests (unchanged) ──

describe('getAuthHeaders', () => {
  it('returns empty object when token is undefined', () => {
    expect(getAuthHeaders(undefined)).toEqual({});
  });

  it('returns empty object when token is empty string', () => {
    expect(getAuthHeaders('')).toEqual({});
  });

  it('returns Bearer header for simple token', () => {
    expect(getAuthHeaders('my-secret-token')).toEqual({
      Authorization: 'Bearer my-secret-token',
    });
  });

  it('returns Bearer header for colon-containing token with default authType', () => {
    // ParisNeo Ollama Proxy format: Bearer user:token
    expect(getAuthHeaders('admin:secret123')).toEqual({
      Authorization: 'Bearer admin:secret123',
    });
  });

  it('returns Basic header when authType is explicitly basic', () => {
    const result = getAuthHeaders('admin:secret123', 'basic');
    const expected = Buffer.from('admin:secret123').toString('base64');
    expect(result).toEqual({
      Authorization: `Basic ${expected}`,
    });
  });
});

describe('isRecoverableToolCallParseError', () => {
  it('returns true for known tool-call parser failures', () => {
    const err = new Error(
      `error parsing tool call: raw='{"tool_calls":[{"tool":"get_container_logs","arguments":{"container_name":"backend","tail":50}}]', err=unexpected end of JSON input`,
    );
    expect(isRecoverableToolCallParseError(err)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRecoverableToolCallParseError(new Error('HTTP 500 internal server error'))).toBe(false);
    expect(isRecoverableToolCallParseError(new Error('timeout'))).toBe(false);
  });
});

describe('looksLikeToolCallAttempt', () => {
  it('returns true for raw JSON with tool_calls', () => {
    const raw = '{"tool_calls":[{"tool":"container.exec","arguments":{"cmd":"ls"}}]}';
    expect(looksLikeToolCallAttempt(raw)).toBe(true);
  });

  it('returns true for raw JSON with leading/trailing whitespace', () => {
    const raw = '  {"tool_calls":[{"tool":"fake_tool","arguments":{}}]}  ';
    expect(looksLikeToolCallAttempt(raw)).toBe(true);
  });

  it('returns true for JSON inside a code fence', () => {
    const fenced = '```json\n{"tool_calls":[{"tool":"container.exec","arguments":{}}]}\n```';
    expect(looksLikeToolCallAttempt(fenced)).toBe(true);
  });

  it('returns true for JSON inside a bare code fence (no language)', () => {
    const fenced = '```\n{"tool_calls":[{"tool":"foo","arguments":{}}]}\n```';
    expect(looksLikeToolCallAttempt(fenced)).toBe(true);
  });

  it('returns false for natural language mentioning tool_calls', () => {
    const natural = 'The response contained "tool_calls" which were invalid. Please try again.';
    expect(looksLikeToolCallAttempt(natural)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(looksLikeToolCallAttempt('')).toBe(false);
  });

  it('returns false for normal assistant response', () => {
    const normal = 'Here are the running containers:\n- nginx (running)\n- redis (running)';
    expect(looksLikeToolCallAttempt(normal)).toBe(false);
  });

  it('returns false for JSON that does not contain tool_calls', () => {
    const json = '{"containers":[{"name":"nginx","state":"running"}]}';
    expect(looksLikeToolCallAttempt(json)).toBe(false);
  });
});

describe('formatChatContext', () => {
  it('returns empty string for empty context', () => {
    expect(formatChatContext({})).toBe('');
  });

  it('formats metrics-dashboard context with container focus instructions', () => {
    const result = formatChatContext({
      page: 'metrics-dashboard',
      containerName: 'cpu-burster',
      containerId: 'abc123',
      endpointId: 1,
      timeRange: '24h',
      currentMetrics: { cpuAvg: 40.8, memoryAvg: 62.3 },
    });

    expect(result).toContain('ACTIVE FOCUS');
    expect(result).toContain('cpu-burster');
    expect(result).toContain('abc123');
    expect(result).toContain('Endpoint ID**: 1');
    expect(result).toContain('24h');
    expect(result).toContain('40.8%');
    expect(result).toContain('62.3%');
    expect(result).toContain('do NOT ask the user which container');
    expect(result).toContain('container_name="cpu-burster"');
  });

  it('omits missing optional fields from metrics-dashboard context', () => {
    const result = formatChatContext({
      page: 'metrics-dashboard',
      containerName: 'web-api',
      endpointId: 2,
    });

    expect(result).toContain('web-api');
    expect(result).toContain('ACTIVE FOCUS');
    expect(result).not.toContain('Container ID');
    expect(result).not.toContain('avg CPU');
    expect(result).not.toContain('avg Memory');
  });

  it('falls back to generic format for non-metrics pages', () => {
    const result = formatChatContext({
      page: 'containers',
      selectedFilter: 'running',
    });

    expect(result).toContain('Additional Context');
    expect(result).toContain('**page**: containers');
    expect(result).toContain('**selectedFilter**: running');
    expect(result).not.toContain('ACTIVE FOCUS');
  });

  it('falls back to generic format when metrics-dashboard has no containerName', () => {
    const result = formatChatContext({
      page: 'metrics-dashboard',
      endpointId: 1,
    });

    expect(result).toContain('Additional Context');
    expect(result).not.toContain('ACTIVE FOCUS');
  });
});

// ── Integration tests for setupLlmNamespace (tool iteration limit) ──

/**
 * Helper: create a mock Socket.IO namespace + socket pair.
 * The namespace emits 'connection' with the socket, and the socket
 * collects event handlers registered via socket.on().
 */
function createMockSocketPair() {
  const socketHandlers = new Map<string, (...args: any[]) => any>();
  const emitted: Array<{ event: string; args: any[] }> = [];

  const socket = {
    id: 'test-socket-id',
    data: { user: { sub: 'test-user' } },
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      socketHandlers.set(event, handler);
    }),
    emit: vi.fn((event: string, ...args: any[]) => {
      emitted.push({ event, args });
    }),
  };

  const ns = new EventEmitter() as any;
  return {
    ns,
    socket,
    socketHandlers,
    emitted,
    connect: () => ns.emit('connection', socket),
  };
}

function baseLlmConfig(overrides: Record<string, any> = {}) {
  return {
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3.2',
    customEnabled: false,
    customEndpointUrl: undefined,
    customEndpointToken: undefined,
    maxTokens: 2000,
    maxToolIterations: 2,
    ...overrides,
  };
}

describe('setupLlmNamespace — tool iteration limit graceful degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Phase 1 is skipped because collectAllTools returns [] (no native tools)
    mockCollectAllTools.mockReturnValue([]);
    mockRouteToolCalls.mockResolvedValue([]);
    mockParseToolCalls.mockReturnValue(null);
  });

  it('generates a partial summary via LLM when tool iteration limit is reached', async () => {
    mockGetEffectiveLlmConfig.mockReturnValue(baseLlmConfig({ maxToolIterations: 2 }));

    const toolCallJson = '{"tool_calls":[{"tool":"get_container_logs","arguments":{"container_name":"nginx","tail":20}}]}';
    mockOllamaChat.mockImplementation(async (opts: any) => {
      if (opts.stream) {
        return (async function* () {
          const isSummaryCall = opts.messages?.some?.(
            (m: any) => m.role === 'system' && m.content?.includes('run out of tool calls'),
          );
          if (isSummaryCall) {
            yield { message: { content: 'Here is a partial summary of your infrastructure.' } };
          } else {
            yield { message: { content: toolCallJson } };
          }
        })();
      }
      // Non-streaming (Phase 1 native): no tool calls
      return { message: { content: '', tool_calls: [] } };
    });

    mockParseToolCalls.mockImplementation((text: string) => {
      if (text.includes('"tool_calls"')) {
        return [{ tool: 'get_container_logs', arguments: { container_name: 'nginx', tail: 20 } }];
      }
      return null;
    });

    mockRouteToolCalls.mockResolvedValue([
      { tool: 'get_container_logs', success: true, data: { logs: 'some log data' } },
    ]);

    const { ns, socketHandlers, emitted, connect } = createMockSocketPair();
    setupLlmNamespace(ns);
    connect();

    const chatHandler = socketHandlers.get('chat:message');
    expect(chatHandler).toBeDefined();

    await chatHandler!({ text: 'Tell me about all my containers' });

    const chunks = emitted
      .filter(e => e.event === 'chat:chunk')
      .map(e => e.args[0])
      .join('');

    // Should contain the LLM-generated partial summary
    expect(chunks).toContain('Here is a partial summary of your infrastructure.');
    // Should contain the truncation notice
    expect(chunks).toContain('tool call limit');
    expect(chunks).toContain('LLM_MAX_TOOL_ITERATIONS');

    // Should have emitted chat:end with the full response
    const endEvents = emitted.filter(e => e.event === 'chat:end');
    expect(endEvents.length).toBe(1);
    const finalContent = endEvents[0].args[0].content;
    expect(finalContent).toContain('partial summary');
    expect(finalContent).toContain('LLM_MAX_TOOL_ITERATIONS');
  });

  it('falls back to raw tool results when summary LLM call fails', async () => {
    mockGetEffectiveLlmConfig.mockReturnValue(baseLlmConfig({ maxToolIterations: 1 }));

    mockOllamaChat.mockImplementation(async (opts: any) => {
      if (opts.stream) {
        const isSummaryCall = opts.messages?.some?.(
          (m: any) => m.role === 'system' && m.content?.includes('run out of tool calls'),
        );
        if (isSummaryCall) {
          throw new Error('Ollama connection refused');
        }
        const toolCallJson = '{"tool_calls":[{"tool":"get_container_metrics","arguments":{}}]}';
        return (async function* () {
          yield { message: { content: toolCallJson } };
        })();
      }
      return { message: { content: '', tool_calls: [] } };
    });

    mockParseToolCalls.mockImplementation((text: string) => {
      if (text.includes('"tool_calls"')) {
        return [{ tool: 'get_container_metrics', arguments: {} }];
      }
      return null;
    });

    mockRouteToolCalls.mockResolvedValue([
      { tool: 'get_container_metrics', success: true, data: { cpu: 42.5 } },
    ]);

    const { ns, socketHandlers, emitted, connect } = createMockSocketPair();
    setupLlmNamespace(ns);
    connect();

    const chatHandler = socketHandlers.get('chat:message');
    await chatHandler!({ text: 'Show me metrics' });

    const chunks = emitted
      .filter(e => e.event === 'chat:chunk')
      .map(e => e.args[0])
      .join('');

    // Should contain fallback raw tool results
    expect(chunks).toContain('raw data');
    expect(chunks).toContain('get_container_metrics');
    // Should still contain the truncation notice
    expect(chunks).toContain('LLM_MAX_TOOL_ITERATIONS');
  });

  it('falls back to hard error when summary fails and no tool results exist', async () => {
    mockGetEffectiveLlmConfig.mockReturnValue(baseLlmConfig({ maxToolIterations: 1 }));

    mockOllamaChat.mockImplementation(async (opts: any) => {
      if (opts.stream) {
        const isSummaryCall = opts.messages?.some?.(
          (m: any) => m.role === 'system' && m.content?.includes('run out of tool calls'),
        );
        if (isSummaryCall) {
          throw new Error('Ollama down');
        }
        const toolCallJson = '{"tool_calls":[{"tool":"get_endpoints","arguments":{}}]}';
        return (async function* () {
          yield { message: { content: toolCallJson } };
        })();
      }
      return { message: { content: '', tool_calls: [] } };
    });

    mockParseToolCalls.mockImplementation((text: string) => {
      if (text.includes('"tool_calls"')) {
        return [{ tool: 'get_endpoints', arguments: {} }];
      }
      return null;
    });

    mockRouteToolCalls.mockResolvedValue([]);

    const { ns, socketHandlers, emitted, connect } = createMockSocketPair();
    setupLlmNamespace(ns);
    connect();

    const chatHandler = socketHandlers.get('chat:message');
    await chatHandler!({ text: 'What is running?' });

    const chunks = emitted
      .filter(e => e.event === 'chat:chunk')
      .map(e => e.args[0])
      .join('');

    // Should contain the hard error fallback
    expect(chunks).toContain('unable to complete the request');
    // Should still contain the truncation notice
    expect(chunks).toContain('LLM_MAX_TOOL_ITERATIONS');
  });

  it('includes the configured limit value in the truncation notice', async () => {
    const customLimit = 7;
    mockGetEffectiveLlmConfig.mockReturnValue(baseLlmConfig({ maxToolIterations: customLimit }));

    mockOllamaChat.mockImplementation(async (opts: any) => {
      if (opts.stream) {
        const isSummaryCall = opts.messages?.some?.(
          (m: any) => m.role === 'system' && m.content?.includes('run out of tool calls'),
        );
        if (isSummaryCall) {
          return (async function* () {
            yield { message: { content: 'Summary text.' } };
          })();
        }
        const toolCallJson = '{"tool_calls":[{"tool":"get_endpoints","arguments":{}}]}';
        return (async function* () {
          yield { message: { content: toolCallJson } };
        })();
      }
      return { message: { content: '', tool_calls: [] } };
    });

    mockParseToolCalls.mockImplementation((text: string) => {
      if (text.includes('"tool_calls"')) {
        return [{ tool: 'get_endpoints', arguments: {} }];
      }
      return null;
    });

    mockRouteToolCalls.mockResolvedValue([
      { tool: 'get_endpoints', success: true, data: [] },
    ]);

    const { ns, socketHandlers, emitted, connect } = createMockSocketPair();
    setupLlmNamespace(ns);
    connect();

    const chatHandler = socketHandlers.get('chat:message');
    await chatHandler!({ text: 'Give me everything' });

    const chunks = emitted
      .filter(e => e.event === 'chat:chunk')
      .map(e => e.args[0])
      .join('');

    // The notice should contain the exact configured limit number
    expect(chunks).toContain(`tool call limit (${customLimit})`);
  });
});
