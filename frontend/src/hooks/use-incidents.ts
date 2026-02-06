import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Incident {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'active' | 'resolved';
  root_cause_insight_id: string | null;
  related_insight_ids: string; // JSON array
  affected_containers: string; // JSON array
  endpoint_id: number | null;
  endpoint_name: string | null;
  correlation_type: string;
  correlation_confidence: 'high' | 'medium' | 'low';
  insight_count: number;
  summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

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
  return useQuery<IncidentsResponse>({
    queryKey: ['incidents', status],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (status) params.status = status;
      return api.get<IncidentsResponse>('/api/incidents', { params });
    },
    refetchInterval: 30000,
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
