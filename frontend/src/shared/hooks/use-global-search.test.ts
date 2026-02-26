import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useGlobalSearch } from './use-global-search';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
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

  it('should fetch without includeLogs by default', async () => {
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
      params: { query: 'web', limit: 8, logLimit: 6, includeLogs: false },
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('should pass includeLogs=true when specified', async () => {
    const mockResponse = {
      query: 'web',
      containers: [],
      images: [],
      stacks: [],
      logs: [{ id: '1:abc:0', endpointId: 1, endpointName: 'prod', containerId: 'abc', containerName: 'web', message: 'web log', timestamp: '2024-01-01T10:00:00Z' }],
    };
    mockApi.get.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useGlobalSearch('web', true, true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.get).toHaveBeenCalledWith('/api/search', {
      params: { query: 'web', limit: 8, logLimit: 6, includeLogs: true },
    });
    expect(result.current.data?.logs).toHaveLength(1);
  });

  it('should not fetch when query is only whitespace', () => {
    renderHook(() => useGlobalSearch('  '), { wrapper: createWrapper() });
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});
