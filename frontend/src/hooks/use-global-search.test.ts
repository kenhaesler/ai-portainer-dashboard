import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useGlobalSearch } from './use-global-search';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/lib/api';
const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('should not fetch when query is shorter than 2 characters', () => {
    renderHook(() => useGlobalSearch('a'), { wrapper: createWrapper() });
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('should not fetch when enabled is false', () => {
    renderHook(() => useGlobalSearch('web', false), { wrapper: createWrapper() });
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('should fetch when query is 2+ characters and enabled', async () => {
    const mockResponse = {
      query: 'web',
      containers: [],
      images: [],
      stacks: [],
      logs: [],
    };
    mockApi.get.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useGlobalSearch('web'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.get).toHaveBeenCalledWith('/api/search', {
      params: { query: 'web', limit: 8, logLimit: 6 },
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('should not fetch when query is only whitespace', () => {
    renderHook(() => useGlobalSearch('  '), { wrapper: createWrapper() });
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});
