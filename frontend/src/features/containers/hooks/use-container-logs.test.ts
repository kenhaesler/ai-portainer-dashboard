import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useContainerLogs } from './use-container-logs';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/lib/api';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        refetchOnWindowFocus: true,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useContainerLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries transient errors once before surfacing the error', async () => {
    mockApi.get.mockRejectedValue(new Error('Too Many Requests'));

    const { result } = renderHook(
      () => useContainerLogs(1, 'c1', { tail: 100, timestamps: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 10000 });
    expect(mockApi.get).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('does not retry EDGE_ASYNC_UNSUPPORTED errors', async () => {
    mockApi.get.mockRejectedValue({
      message: 'Edge Async endpoints do not support live logs',
      code: 'EDGE_ASYNC_UNSUPPORTED',
      status: 422,
    });

    const { result } = renderHook(
      () => useContainerLogs(1, 'c1', { tail: 100, timestamps: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApi.get).toHaveBeenCalledTimes(1); // no retry for permanent errors
  });

  it('passes timestamps=false to the API request', async () => {
    mockApi.get.mockResolvedValue({
      logs: 'line1\nline2',
      container: 'c1',
      endpointId: 1,
    });

    const { result } = renderHook(
      () => useContainerLogs(1, 'c1', { tail: 500, timestamps: false }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/containers/1/c1/logs', {
      params: { tail: 500, timestamps: false },
    });
  });
});
