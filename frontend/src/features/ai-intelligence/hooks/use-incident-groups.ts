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
  /**
   * ISO-8601 UTC, or null when the column is null.
   *
   * These used to be typed non-null while the server sent Postgres' own text
   * form (`2026-07-26 08:46:29.123456+00`) via a `::text` cast. That is not
   * valid ISO-8601 once `formatDate` swaps the space for a `T`, so `new Date()`
   * rejected it and every row rendered the literal string "Invalid date". The
   * cast is gone; null is now the honest signal for "no timestamp".
   */
  earliest_at: string | null;
  latest_update_at: string | null;
  top_containers: Array<{
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string | null;
    incident_ids: string[];
    incident_count: number;
    latest_at: string | null;
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
