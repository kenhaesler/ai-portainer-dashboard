import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/llm/stats')) {
        return Promise.resolve({
          totalQueries: 50,
          totalTokens: 25000,
          avgLatencyMs: 800,
          errorRate: 1.5,
          avgFeedbackScore: 3.8,
          feedbackCount: 10,
          modelBreakdown: [],
        });
      }
      return Promise.resolve([
        { id: 1, trace_id: 'tr-1', model: 'llama3.2', total_tokens: 500 },
      ]);
    }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { api } from '@/lib/api';
import { useLlmStats, useLlmTraces } from './use-llm-observability';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useLlmStats', () => {
  it('fetches LLM stats', async () => {
    const { result } = renderHook(() => useLlmStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalQueries).toBe(50);
    expect(result.current.data?.avgLatencyMs).toBe(800);
  });

  it('normalizes partial stats payload without crashing', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      totalQueries: 12,
      totalTokens: 900,
      // modelBreakdown intentionally missing
    });

    const { result } = renderHook(() => useLlmStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalQueries).toBe(12);
    expect(result.current.data?.modelBreakdown).toEqual([]);
    expect(result.current.data?.errorRate).toBe(0);
  });
});

describe('useLlmTraces', () => {
  it('fetches LLM traces', async () => {
    const { result } = renderHook(() => useLlmTraces(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});
