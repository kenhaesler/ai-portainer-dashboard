import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useResource } from './use-resource';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

interface TestItem {
  id: number;
  name: string;
}

describe('useResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls api.get with the given path', async () => {
    const data: TestItem[] = [{ id: 1, name: 'test' }];
    mockApi.get.mockResolvedValue(data);

    const { result } = renderHook(
      () => useResource<TestItem[]>(['items'], '/api/items'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.get).toHaveBeenCalledWith('/api/items');
    expect(result.current.data).toEqual(data);
  });

  it('passes staleTime through options', async () => {
    mockApi.get.mockResolvedValue([]);

    const { result } = renderHook(
      () =>
        useResource<TestItem[]>(['items'], '/api/items', {
          staleTime: 60_000,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  it('passes additional options like refetchOnMount', async () => {
    mockApi.get.mockResolvedValue([]);

    const { result } = renderHook(
      () =>
        useResource<TestItem[]>(['items'], '/api/items', {
          refetchOnMount: 'always',
          refetchOnWindowFocus: false,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns error state on fetch failure', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useResource<TestItem[]>(['items'], '/api/items'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
  });
});
