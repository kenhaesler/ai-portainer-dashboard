import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/shared/lib/api';

/**
 * Prefetch common data on hover/focus of navigation links to eliminate
 * loading spinners when navigating between pages.
 */
export function usePrefetch() {
  const queryClient = useQueryClient();

  const prefetchContainers = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['containers', undefined],
      queryFn: () => api.get('/api/containers'),
      staleTime: 30 * 1000,
    });
  }, [queryClient]);

  const prefetchEndpoints = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['endpoints'],
      queryFn: () => api.get('/api/endpoints'),
      staleTime: 60 * 1000,
    });
  }, [queryClient]);

  const prefetchDashboard = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['dashboard', 'full', 8],
      queryFn: () => api.get('/api/dashboard/full?topN=8&kpiHistoryHours=24'),
      staleTime: 60 * 1000,
    });
  }, [queryClient]);

  const prefetchImages = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['images', undefined],
      queryFn: () => api.get('/api/images'),
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);

  const prefetchStacks = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['stacks'],
      queryFn: () => api.get('/api/stacks'),
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);

  return {
    prefetchContainers,
    prefetchEndpoints,
    prefetchDashboard,
    prefetchImages,
    prefetchStacks,
  };
}
