import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Endpoint {
  id: number;
  name: string;
  type: number;
  url: string;
  status: 'up' | 'down';
  containersRunning: number;
  containersStopped: number;
  containersHealthy: number;
  containersUnhealthy: number;
  totalContainers: number;
  stackCount: number;
  totalCpu: number;
  totalMemory: number;
  isEdge: boolean;
  agentVersion?: string;
  lastCheckIn?: number;
}

export function useEndpoints() {
  return useQuery<Endpoint[]>({
    queryKey: ['endpoints'],
    queryFn: async () => {
      const response = await api.get('/api/endpoints');
      return response.data;
    },
    staleTime: 60 * 1000,
  });
}
