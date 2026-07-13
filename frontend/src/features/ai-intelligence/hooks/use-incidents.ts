import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Incident } from '@dashboard/contracts';
import { api } from '@/shared/lib/api';
import { usePageVisibility } from '@/shared/hooks/use-page-visibility';

// Canonical wire shape lives in @dashboard/contracts (#1509). Re-exported so
// existing `import { Incident } from '.../use-incidents'` call sites keep working.
export type { Incident };

interface IncidentCounts {
  active: number;
  resolved: number;
  total: number;
}

interface IncidentsResponse {
  incidents: Incident[];
  counts: IncidentCounts;
  limit: number;
  offset: number;
}

export function useIncidents(status?: 'active' | 'resolved') {
  const isPageVisible = usePageVisibility();

  return useQuery<IncidentsResponse>({
    queryKey: ['incidents', status],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (status) params.status = status;
      return api.get<IncidentsResponse>('/api/incidents', { params });
    },
    refetchInterval: isPageVisible ? 30_000 : false,
  });
}

export function useIncidentDetail(id: string | null) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: async () => {
      return api.get(`/api/incidents/${id}`);
    },
    enabled: !!id,
  });
}

export function useResolveIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return api.post(`/api/incidents/${id}/resolve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

export interface BatchResolveResponse {
  resolved: string[];
  failed: Array<{ id: string; error: string }>;
}

export function useBatchResolveIncidents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<BatchResolveResponse>('/api/incidents/resolve', { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-groups'] });
    },
  });
}
