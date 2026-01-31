import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';

interface DashboardSummary {
  endpoints: {
    total: number;
    healthy: number;
    unhealthy: number;
  };
  containers: {
    total: number;
    running: number;
    stopped: number;
    error: number;
  };
  stacks: {
    total: number;
    active: number;
  };
  alerts: {
    critical: number;
    warning: number;
    info: number;
  };
  systemHealth: number;
}

export function useDashboard() {
  const { interval, enabled } = useAutoRefresh(30);

  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => {
      const response = await api.get('/api/dashboard/summary');
      return response.data;
    },
    staleTime: 30 * 1000,
    refetchInterval: enabled ? interval * 1000 : false,
  });
}
