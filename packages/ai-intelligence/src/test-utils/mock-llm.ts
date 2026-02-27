/**
 * Shared mock factories for llm-client and llm-trace-store.
 * Eliminates duplicate inline vi.mock() stubs across test files.
 *
 * Usage:
 *   import { createLlmTraceStoreMock } from '../test-utils/mock-llm.js';
 *   vi.mock('../services/llm-trace-store.js', async () =>
 *     (await import('../test-utils/mock-llm.js')).createLlmTraceStoreMock()
 *   );
 */
import { vi } from 'vitest';

/** Returns a fresh mock for llm-trace-store.ts */
export function createLlmTraceStoreMock(): Record<string, unknown> {
  return {
    insertLlmTrace: vi.fn(),
    getRecentTraces: vi.fn().mockResolvedValue([]),
    getLlmStats: vi.fn().mockResolvedValue({
      totalQueries: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      modelBreakdown: [],
    }),
    getLlmTraceSummary: vi.fn().mockResolvedValue({
      totalQueries: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      modelBreakdown: [],
    }),
  };
}
