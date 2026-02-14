import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  endpointId: number;
  endpointName: string;
  ports: Array<{
    private: number;
    public?: number;
    type: string;
  }>;
  created: number;
  labels: Record<string, string>;
  networks: string[];
  networkIPs?: Record<string, string>;
  healthStatus?: string;
}

export function useContainers(endpointId?: number) {
  return useQuery<Container[]>({
    queryKey: ['containers', endpointId],
    queryFn: async () => {
      const path = endpointId
        ? `/api/containers?endpointId=${endpointId}`
        : '/api/containers';
      return api.get<Container[]>(path);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
