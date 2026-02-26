import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface StalenessRecord {
  id: number;
  image_name: string;
  image_tag: string;
  registry: string;
  local_digest: string | null;
  remote_digest: string | null;
  is_stale: number;
  days_since_update: number | null;
  last_checked_at: string;
  created_at: string;
}

export interface StalenessSummary {
  total: number;
  stale: number;
  upToDate: number;
  unchecked: number;
}

interface StalenessResponse {
  records: StalenessRecord[];
  summary: StalenessSummary;
}

export function useImageStaleness() {
  return useQuery<StalenessResponse>({
    queryKey: ['image-staleness'],
    queryFn: () => api.get<StalenessResponse>('/api/images/staleness'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTriggerStalenessCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; checked: number; stale: number }>('/api/images/staleness/check', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['image-staleness'] });
    },
  });
}
