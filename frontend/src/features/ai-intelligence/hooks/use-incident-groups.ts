import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { usePageVisibility } from '@/shared/hooks/use-page-visibility';

export interface IncidentGroup {
  signature: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  incident_count: number;
  container_count: number;
  alert_count: number;
  earliest_at: string;
  latest_update_at: string;
  top_containers: Array<{
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
    incident_ids: string[];
    incident_count: number;
    latest_at: string;
    latest_summary: string | null;
    latest_description: string | null;
  }>;
  all_container_names: string[];
  names_truncated: boolean;
}

export interface IncidentGroupsResponse {
  groups: IncidentGroup[];
  endpoint_facets: Array<{
    endpoint_id: number | null;
    endpoint_name: string | null;
    incident_count: number;
  }>;
  total_active: number;
}

export interface UseIncidentGroupsParams {
  status?: 'active' | 'resolved';
  endpointId?: number;
  since?: '1h' | '24h' | '7d';
  severity?: 'critical' | 'warning' | 'info';
}

export function useIncidentGroups(params: UseIncidentGroupsParams = {}) {
  const isVisible = usePageVisibility();

  const queryParams: Record<string, string> = {};
  if (params.status) queryParams.status = params.status;
  if (params.endpointId !== undefined) queryParams.endpoint_id = String(params.endpointId);
  if (params.since) queryParams.since = params.since;
  if (params.severity) queryParams.severity = params.severity;

  return useQuery<IncidentGroupsResponse>({
    queryKey: ['incident-groups', params.status, params.endpointId, params.since, params.severity],
    queryFn: () => api.get<IncidentGroupsResponse>('/api/incidents/groups', { params: queryParams }),
    refetchInterval: isVisible ? 30_000 : false,
  });
}
