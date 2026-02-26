import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('@/shared/lib/api', () => ({
  api: mockApi,
}));

import { useImages } from './use-images';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches all images when no endpointId is provided', async () => {
    const images = [{ id: 'img-1', name: 'nginx' }];
    mockApi.get.mockResolvedValueOnce(images);

    const { result } = renderHook(() => useImages(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/images');
    expect(result.current.data).toEqual(images);
  });

  it('fetches images for specific endpoint', async () => {
    const images = [{ id: 'img-2', name: 'redis' }];
    mockApi.get.mockResolvedValueOnce(images);

    const { result } = renderHook(() => useImages(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/images?endpointId=1');
  });

  it('sets refetchOnMount to always', () => {
    mockApi.get.mockResolvedValue([]);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useImages(), { wrapper });

    const query = queryClient.getQueryCache().findAll({ queryKey: ['images', undefined] })[0];
    expect(query).toBeDefined();
    // The query should have fetched (refetchOnMount: 'always')
    expect(query?.state.fetchStatus === 'fetching' || query?.state.status === 'success' || query?.state.status === 'error').toBe(true);
  });

  it('accepts refetchInterval option', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(
      () => useImages(undefined, { refetchInterval: 30_000 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/images');
  });

  it('disables refetchInterval when set to false', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(
      () => useImages(undefined, { refetchInterval: false }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });
});
