import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

type CacheResource = 'endpoints' | 'containers' | 'images' | 'networks' | 'stacks';

export function useForceRefresh(resource: CacheResource, refetch: () => Promise<unknown>) {
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);

  const forceRefresh = useCallback(async () => {
    setIsForceRefreshing(true);
    try {
      await api.request('/api/admin/cache/invalidate', {
        method: 'POST',
        params: { resource },
      }).catch(() => {
        // swallow invalidation errors - still refetch below
      });
      await refetch();
    } finally {
      setIsForceRefreshing(false);
    }
  }, [resource, refetch]);

  return { forceRefresh, isForceRefreshing };
}
