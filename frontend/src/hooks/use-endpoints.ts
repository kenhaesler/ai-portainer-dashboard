import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Endpoint {
  id: number;
  name: string;
  type: string;
  url: string;
  status: 'up' | 'down' | 'unknown';
  publicURL?: string;
  groupId?: number;
  tags?: string[];
}

export function useEndpoints() {
  return useQuery<Endpoint[]>({
    queryKey: ['endpoints'],
    queryFn: () => api.get<Endpoint[]>('/api/endpoints'),
    staleTime: 60 * 1000,
  });
}
