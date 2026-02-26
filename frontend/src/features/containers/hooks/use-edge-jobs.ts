import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface EdgeJob {
  Id: number;
  Name: string;
  CronExpression: string;
  Recurring: boolean;
  Created: number;
  ScriptPath?: string;
  Version?: number;
}

export function useEdgeJobs() {
  return useQuery<EdgeJob[]>({
    queryKey: ['edge-jobs'],
    queryFn: () => api.get<EdgeJob[]>('/api/edge-jobs'),
    staleTime: 60_000,
  });
}
