/**
 * Shared mock factories for llm-client and ollama.
 * Eliminates duplicate inline vi.mock() stubs across 15+ test files.
 *
 * Usage:
 *   import { createLlmClientMock } from '../test-utils/mock-llm.js';
 *   vi.mock('../services/llm-client.js', () => createLlmClientMock());
 */
import { vi } from 'vitest';

/** Returns a fresh mock covering every export from llm-client.ts */
export function createLlmClientMock() {
  return {
    getLlmQueueSize: vi.fn().mockReturnValue({ pending: 0, active: 0 }),
    getLlmDispatcher: vi.fn().mockReturnValue(undefined),
    getFetchErrorMessage: vi.fn((err: unknown) => String(err)),
    llmFetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    createOllamaClient: vi.fn().mockReturnValue({ chat: vi.fn(), list: vi.fn(), pull: vi.fn() }),
    createConfiguredOllamaClient: vi.fn().mockResolvedValue({ chat: vi.fn(), list: vi.fn(), pull: vi.fn() }),
    getAuthHeaders: vi.fn().mockReturnValue({}),
    chatStream: vi.fn().mockResolvedValue('mock LLM response'),
    buildInfrastructureContext: vi.fn().mockResolvedValue(''),
    isOllamaAvailable: vi.fn().mockResolvedValue(true),
    ensureModel: vi.fn().mockResolvedValue(undefined),
  };
}

/** Returns a fresh mock covering the ollama SDK module */
export function createOllamaMock() {
  const mockChat = vi.fn();
  return {
    Ollama: vi.fn().mockImplementation(() => ({
      chat: mockChat,
      list: vi.fn().mockResolvedValue({ models: [] }),
      pull: vi.fn().mockResolvedValue(undefined),
    })),
    /** Access the underlying chat mock for assertions */
    _mockChat: mockChat,
  };
}

/** Returns a fresh mock for llm-trace-store.ts */
export function createLlmTraceStoreMock() {
  return {
    insertLlmTrace: vi.fn(),
    getLlmTraceSummary: vi.fn().mockResolvedValue({
      totalQueries: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      modelBreakdown: [],
    }),
  };
}
