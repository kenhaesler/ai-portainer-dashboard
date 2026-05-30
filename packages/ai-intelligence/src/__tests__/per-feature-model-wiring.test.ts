// packages/ai-intelligence/src/__tests__/per-feature-model-wiring.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { chatStream } from '../services/llm-client.js';

const DEFAULT_LLM_CONFIG = {
  apiUrl: 'http://localhost:9999/v1/chat/completions',
  apiToken: 'tok',
  model: 'default-model',
  authType: 'bearer' as const,
  maxTokens: 1000,
  maxToolIterations: 5,
};

const {
  mockGetEffectiveLlmConfigPromptStore,
  mockGetEffectiveLlmConfigGlobal,
  mockGetEffectivePrompt,
  mockInsertLlmTrace,
  mockUndiciFetch,
} = vi.hoisted(() => ({
  mockGetEffectiveLlmConfigPromptStore: vi.fn(),
  mockGetEffectiveLlmConfigGlobal: vi.fn(),
  mockGetEffectivePrompt: vi.fn(),
  mockInsertLlmTrace: vi.fn().mockResolvedValue(undefined),
  mockUndiciFetch: vi.fn(),
}));

vi.mock('../services/prompt-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/prompt-store.js')>();
  return {
    ...actual,
    getEffectiveLlmConfig: mockGetEffectiveLlmConfigPromptStore,
    getEffectivePrompt: mockGetEffectivePrompt,
  };
});

vi.mock('@dashboard/core/services/settings-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dashboard/core/services/settings-store.js')>();
  return {
    ...actual,
    getEffectiveLlmConfig: (...args: unknown[]) => mockGetEffectiveLlmConfigGlobal(...args),
  };
});

vi.mock('../services/llm-trace-store.js', () => ({
  insertLlmTrace: (...args: unknown[]) => mockInsertLlmTrace(...args),
}));

// Mock undici (the production code uses undici.fetch, NOT globalThis.fetch).
vi.mock('undici', () => ({
  Agent: vi.fn(),
  fetch: (...args: unknown[]) => mockUndiciFetch(...args),
}));

function mockSseResponse(payload: string) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockGetEffectivePrompt.mockResolvedValue('test prompt');
  mockInsertLlmTrace.mockResolvedValue(undefined);
  // Provide a valid default config from the global resolver so that, in the
  // current (pre-Task-3) code, chatStream still reaches the fetch step. This
  // ensures these tests fail at the wiring assertion stage, not at a
  // precondition crash like "Cannot read properties of undefined".
  mockGetEffectiveLlmConfigGlobal.mockResolvedValue({ ...DEFAULT_LLM_CONFIG });
  mockUndiciFetch.mockResolvedValue(
    mockSseResponse('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'),
  );
  setConfigForTest({ LLM_VERIFY_SSL: true, LLM_REQUEST_TIMEOUT: 120000 });
});

afterEach(() => {
  resetConfig();
});

describe('chatStream — per-feature model resolution', () => {
  it('uses the feature-aware resolver when a feature key is passed', async () => {
    mockGetEffectiveLlmConfigPromptStore.mockResolvedValue({
      apiUrl: 'http://localhost:9999/v1/chat/completions',
      apiToken: 'tok',
      model: 'feature-specific-model',
      authType: 'bearer',
      maxTokens: 1000,
      maxToolIterations: 5,
    });

    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'system',
      () => {},
      'anomaly_explainer',
    );

    expect(mockGetEffectiveLlmConfigPromptStore).toHaveBeenCalledWith('anomaly_explainer');
    // Lock in the migration: after Task 3 the global resolver must NOT be
    // called from chatStream — the feature-aware resolver replaces it.
    expect(mockGetEffectiveLlmConfigGlobal).not.toHaveBeenCalled();

    const fetchCall = mockUndiciFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.model).toBe('feature-specific-model');
  });

  it('includes temperature in the request body when the resolver returns one', async () => {
    mockGetEffectiveLlmConfigPromptStore.mockResolvedValue({
      apiUrl: 'http://localhost:9999/v1/chat/completions',
      apiToken: 'tok',
      model: 'm',
      authType: 'bearer',
      maxTokens: 1000,
      maxToolIterations: 5,
      temperature: 0.2,
    });

    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'system',
      () => {},
      'log_analyzer',
    );

    const fetchCall = mockUndiciFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.temperature).toBe(0.2);
  });

  it('omits temperature when the resolver does not return one', async () => {
    mockGetEffectiveLlmConfigPromptStore.mockResolvedValue({
      apiUrl: 'http://localhost:9999/v1/chat/completions',
      apiToken: 'tok',
      model: 'm',
      authType: 'bearer',
      maxTokens: 1000,
      maxToolIterations: 5,
    });

    await chatStream([{ role: 'user', content: 'hi' }], 'system', () => {});

    const fetchCall = mockUndiciFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.temperature).toBeUndefined();
  });
});
