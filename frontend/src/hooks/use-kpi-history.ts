import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export interface KpiSnapshot {
  endpoints: number;
  endpoints_up: number;
  endpoints_down: number;
  running: number;
  stopped: number;
  healthy: number;
  unhealthy: number;
  total: number;
  stacks: number;
  timestamp: string;
}

interface KpiHistoryResponse {
  snapshots: KpiSnapshot[];
}

export function useKpiHistory(hours = 24) {
  const { isAuthenticated, token } = useAuth();

  return useQuery<KpiSnapshot[]>({
    queryKey: ['dashboard', 'kpi-history', hours],
    queryFn: async () => {
      const res = await api.get<KpiHistoryResponse>('/api/dashboard/kpi-history', {
        params: { hours: String(hours) },
      });
      return res.snapshots;
    },
    enabled: isAuthenticated && !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000,
  });
}
