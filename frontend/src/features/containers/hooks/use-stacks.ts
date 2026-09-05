import { useResource } from '@/shared/hooks/use-resource';
import { STALE_TIMES } from '@/shared/lib/query-constants';
import type { StackStatus } from '@dashboard/contracts';

export interface Stack {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: StackStatus;
  createdAt?: number;
  updatedAt?: number;
  envCount: number;
  source?: 'portainer' | 'compose-label';
  containerCount?: number;
}

export function useStacks() {
  return useResource<Stack[]>(['stacks'], '/api/stacks', {
    staleTime: STALE_TIMES.LONG,
  });
}
