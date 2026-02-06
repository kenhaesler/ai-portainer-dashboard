import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePrefetch } from './use-prefetch';

const mockPrefetchQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ prefetchQuery: mockPrefetchQuery }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => Promise.resolve([])) },
}));

describe('usePrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return prefetch functions', () => {
    const { result } = renderHook(() => usePrefetch());

    expect(result.current.prefetchContainers).toBeTypeOf('function');
    expect(result.current.prefetchEndpoints).toBeTypeOf('function');
    expect(result.current.prefetchDashboard).toBeTypeOf('function');
    expect(result.current.prefetchImages).toBeTypeOf('function');
    expect(result.current.prefetchStacks).toBeTypeOf('function');
  });

  it('should call prefetchQuery with correct key for containers', () => {
    const { result } = renderHook(() => usePrefetch());
    result.current.prefetchContainers();

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['containers', undefined],
        staleTime: 30_000,
      }),
    );
  });

  it('should call prefetchQuery with correct key for endpoints', () => {
    const { result } = renderHook(() => usePrefetch());
    result.current.prefetchEndpoints();

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['endpoints'],
        staleTime: 60_000,
      }),
    );
  });

  it('should call prefetchQuery with correct key for images', () => {
    const { result } = renderHook(() => usePrefetch());
    result.current.prefetchImages();

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['images', undefined],
        staleTime: 5 * 60_000,
      }),
    );
  });

  it('should call prefetchQuery with correct key for stacks', () => {
    const { result } = renderHook(() => usePrefetch());
    result.current.prefetchStacks();

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['stacks'],
        staleTime: 5 * 60_000,
      }),
    );
  });

  it('should call prefetchQuery with correct key for dashboard', () => {
    const { result } = renderHook(() => usePrefetch());
    result.current.prefetchDashboard();

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['dashboard', 'summary'],
        staleTime: 30_000,
      }),
    );
  });
});
