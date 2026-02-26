import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      size: 0, l1Size: 0, l2Size: 0, hits: 0, misses: 0, hitRate: '0%', backend: 'memory-only', entries: [],
    }),
    post: vi.fn().mockResolvedValue({}),
  },
}));

let mockIsVisible = true;
vi.mock('@/hooks/use-page-visibility', () => ({
  usePageVisibility: () => mockIsVisible,
}));

import { useCacheStats } from './use-cache-admin';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useCacheStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVisible = true;
  });

  it('polls every 30s when page is visible', () => {
    const { result } = renderHook(() => useCacheStats(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('pending');
  });

  it('disables polling when page is hidden', () => {
    mockIsVisible = false;
    const { result } = renderHook(() => useCacheStats(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('pending');
  });

  it('fetches cache stats from the correct endpoint', async () => {
    const { api } = await import('@/lib/api');
    renderHook(() => useCacheStats(), { wrapper: createWrapper() });
    await vi.waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/admin/cache/stats');
    });
  });
});
