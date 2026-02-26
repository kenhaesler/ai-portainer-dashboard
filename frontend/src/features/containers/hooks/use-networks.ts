import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  return useQuery<Network[]>({
    queryKey: ['networks', endpointId],
    queryFn: async () => {
      const path = endpointId
        ? `/api/networks?endpointId=${endpointId}`
        : '/api/networks';
      return api.get<Network[]>(path);
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}
