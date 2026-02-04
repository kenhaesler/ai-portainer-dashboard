import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Stack {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: number;
  creationDate: string;
  updateDate: string;
  env?: Array<{
    name: string;
    value: string;
  }>;
}

export function useStacks() {
  return useQuery<Stack[]>({
    queryKey: ['stacks'],
    queryFn: () => api.get<Stack[]>('/api/stacks'),
  });
}
