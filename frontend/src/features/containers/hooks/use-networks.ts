import { useResource } from '@/shared/hooks/use-resource';
import { STALE_TIMES } from '@/shared/lib/query-constants';

export interface Network {
  id: string;
  name: string;
  driver?: string;
  scope?: string;
  subnet?: string;
  gateway?: string;
  endpointId: number;
  endpointName: string;
  containers: string[];
}

export function useNetworks(endpointId?: number) {
  const path = endpointId
    ? `/api/networks?endpointId=${endpointId}`
    : '/api/networks';
  return useResource<Network[]>(['networks', endpointId], path, {
    staleTime: STALE_TIMES.LONG,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}
