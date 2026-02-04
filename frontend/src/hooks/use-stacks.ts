import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Stack {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: 'active' | 'inactive';
  createdAt?: number;
  updatedAt?: number;
  envCount: number;
}

export function useStacks() {
  return useQuery<Stack[]>({
    queryKey: ['stacks'],
    queryFn: () => api.get<Stack[]>('/api/stacks'),
  });
}
