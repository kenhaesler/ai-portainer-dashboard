import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import type { DashboardSummary } from '@/hooks/use-dashboard';
import type { DashboardResources } from '@/hooks/use-dashboard-resources';
import type { Endpoint } from '@/hooks/use-endpoints';
import type { KpiSnapshot } from '@/hooks/use-kpi-history';

export interface DashboardFull {
  summary: DashboardSummary;
  resources: DashboardResources;
  endpoints: Endpoint[];
  kpiHistory?: KpiSnapshot[];
}

function hasAuthToken(): boolean {
  const apiToken = typeof (api as { getToken?: () => string | null }).getToken === 'function'
    ? api.getToken()
    : null;
  if (apiToken) return true;
  try {
    return !!window.localStorage.getItem('auth_token');
  } catch {
    return false;
  }
}

/**
 * Unified dashboard hook that fetches summary + resources + endpoints in a single request.
 * Populates individual query caches so that components using useDashboard(), useDashboardResources(),
 * and useEndpoints() will get the data without making separate API calls.
 */
export function useDashboardFull(topN: number = 10) {
  const queryClient = useQueryClient();
  const { interval, enabled } = useAutoRefresh(30);
  const hasToken = hasAuthToken();

  const query = useQuery<DashboardFull>({
    queryKey: ['dashboard', 'full', topN],
    queryFn: () => api.get<DashboardFull>(`/api/dashboard/full?topN=${topN}&kpiHistoryHours=24`),
    enabled: hasToken,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? interval * 1000 : false,
  });

  // Populate individual query caches when unified data arrives
  useEffect(() => {
    if (query.data) {
      queryClient.setQueryData(['dashboard', 'summary'], query.data.summary);
      queryClient.setQueryData(['dashboard', 'resources', topN], query.data.resources);
      queryClient.setQueryData(['endpoints'], query.data.endpoints);
      if (query.data.kpiHistory) {
        queryClient.setQueryData(['dashboard', 'kpi-history', 24], query.data.kpiHistory);
      }
    }
  }, [query.data, queryClient, topN]);

  return query;
}
