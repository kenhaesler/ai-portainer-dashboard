import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import {
  useContainers,
  usePaginatedContainers,
  useFavoriteContainers,
  useContainerCount,
} from './use-containers';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches all containers when no params are provided', async () => {
    const containers = [{ id: 'c1', name: 'test' }];
    mockApi.get.mockResolvedValueOnce(containers);

    const { result } = renderHook(() => useContainers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/containers');
    expect(result.current.data).toEqual(containers);
  });

  it('passes endpointId as query param', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useContainers({ endpointId: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/containers?endpointId=5');
  });

  it('passes search and state params', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(
      () => useContainers({ search: 'web', state: 'running' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockApi.get.mock.calls[0][0];
    expect(calledUrl).toContain('search=web');
    expect(calledUrl).toContain('state=running');
  });

  it('works with default params (backward compat)', async () => {
    const containers = [{ id: 'c1' }];
    mockApi.get.mockResolvedValueOnce(containers);

    const { result } = renderHook(() => useContainers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/containers');
  });

  it('normalizes partial wrapped response into container array', async () => {
    const containers = [{ id: 'c1', name: 'partial' }];
    mockApi.get.mockResolvedValueOnce({
      data: containers,
      partial: true,
      failedEndpoints: ['edge-1: timeout'],
    });

    const { result } = renderHook(() => useContainers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(containers);
  });
});

describe('usePaginatedContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches paginated containers with page/pageSize', async () => {
    const paginated = { data: [], total: 100, page: 2, pageSize: 25 };
    mockApi.get.mockResolvedValueOnce(paginated);

    const { result } = renderHook(
      () => usePaginatedContainers({ page: 2, pageSize: 25, search: 'web', state: 'running' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockApi.get.mock.calls[0][0];
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('pageSize=25');
    expect(calledUrl).toContain('search=web');
    expect(calledUrl).toContain('state=running');
    expect(result.current.data).toEqual(paginated);
  });

  it('includes endpointId when provided', async () => {
    const paginated = { data: [], total: 50, page: 1, pageSize: 10 };
    mockApi.get.mockResolvedValueOnce(paginated);

    const { result } = renderHook(
      () => usePaginatedContainers({ page: 1, pageSize: 10, endpointId: 3 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockApi.get.mock.calls[0][0];
    expect(calledUrl).toContain('endpointId=3');
  });
});

describe('useFavoriteContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches containers by favorite IDs', async () => {
    const containers = [{ id: 'c1', name: 'fav1' }];
    mockApi.get.mockResolvedValueOnce(containers);

    const ids = ['1:c1', '2:c2'];
    const { result } = renderHook(() => useFavoriteContainers(ids), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockApi.get.mock.calls[0][0];
    // ids are comma-separated in a single param (not repeated &ids= params)
    expect(calledUrl).toBe('/api/containers/favorites?ids=1%3Ac1,2%3Ac2');
  });

  it('does not fetch when ids is empty', () => {
    const { result } = renderHook(() => useFavoriteContainers([]), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});

describe('useContainerCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches container count', async () => {
    mockApi.get.mockResolvedValueOnce({ count: 42 });

    const { result } = renderHook(() => useContainerCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/containers/count');
    expect(result.current.data).toEqual({ count: 42 });
  });
});
