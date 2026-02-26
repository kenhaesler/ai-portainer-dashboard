import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface Stack {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: 'active' | 'inactive';
  createdAt?: number;
  updatedAt?: number;
  envCount: number;
  source?: 'portainer' | 'compose-label';
  containerCount?: number;
}

export function useStacks() {
  return useQuery<Stack[]>({
    queryKey: ['stacks'],
    queryFn: () => api.get<Stack[]>('/api/stacks'),
    staleTime: 5 * 60 * 1000,
  });
}
