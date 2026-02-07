import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  return useQuery<CacheStats>({
    queryKey: ['admin', 'cache', 'stats'],
    queryFn: () => api.get<CacheStats>('/api/admin/cache/stats'),
    refetchInterval: 10_000,
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
