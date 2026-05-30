import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForceRefresh } from './use-force-refresh';

vi.mock('@/shared/lib/api', () => ({
  api: {
    request: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';

const mockApi = vi.mocked(api);

describe('useForceRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls invalidate endpoint then refetch', async () => {
    mockApi.request.mockResolvedValue({ success: true });
    const refetch = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useForceRefresh('containers', refetch));

    await act(async () => {
      await result.current.forceRefresh();
    });

    expect(mockApi.request).toHaveBeenCalledWith('/api/admin/cache/invalidate', {
      method: 'POST',
      params: { resource: 'containers' },
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still refetches if invalidation fails', async () => {
    mockApi.request.mockRejectedValue(new Error('Network error'));
    const refetch = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useForceRefresh('endpoints', refetch));

    await act(async () => {
      await result.current.forceRefresh();
    });

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('tracks isForceRefreshing loading state', async () => {
    let resolveRefetch: () => void;
    const refetchPromise = new Promise<void>((resolve) => {
      resolveRefetch = resolve;
    });
    mockApi.request.mockResolvedValue({ success: true });
    const refetch = vi.fn().mockReturnValue(refetchPromise);

    const { result } = renderHook(() => useForceRefresh('stacks', refetch));

    expect(result.current.isForceRefreshing).toBe(false);

    let forceRefreshPromise: Promise<void>;
    act(() => {
      forceRefreshPromise = result.current.forceRefresh();
    });

    // Wait for microtasks to flush (the invalidate .catch() resolves)
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isForceRefreshing).toBe(true);

    await act(async () => {
      resolveRefetch!();
      await forceRefreshPromise!;
    });

    expect(result.current.isForceRefreshing).toBe(false);
  });
});
