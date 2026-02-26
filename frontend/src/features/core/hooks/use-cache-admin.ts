import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { usePageVisibility } from '@/shared/hooks/use-page-visibility';

interface CacheEntry {
  key: string;
  expiresIn: number;
}

interface CacheStats {
  size: number;
  l1Size: number;
  l2Size: number;
  hits: number;
  misses: number;
  hitRate: string;
  backend: 'multi-layer' | 'memory-only';
  entries: CacheEntry[];
}

export function useCacheStats() {
  const isPageVisible = usePageVisibility();

  return useQuery<CacheStats>({
    queryKey: ['admin', 'cache', 'stats'],
    queryFn: () => api.get<CacheStats>('/api/admin/cache/stats'),
    refetchInterval: isPageVisible ? 30_000 : false,
  });
}

export function useCacheClear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post('/api/admin/cache/clear'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cache', 'stats'] });
    },
  });
}
