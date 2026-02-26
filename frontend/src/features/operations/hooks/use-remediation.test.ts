import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useRemediationActions } from './use-remediation';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

describe('useRemediationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry on 429-style errors', async () => {
    mockApi.get.mockRejectedValue(new Error('Too Many Requests'));

    const { result } = renderHook(() => useRemediationActions('pending'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  it('sends status filter to remediation actions endpoint', async () => {
    mockApi.get.mockResolvedValue([]);

    const { result } = renderHook(() => useRemediationActions('pending'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/remediation/actions', {
      params: { status: 'pending' },
    });
  });
});
