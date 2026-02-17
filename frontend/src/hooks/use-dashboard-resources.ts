import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';

export interface StackResourceUsage {
  name: string;
  containerCount: number;
  runningCount: number;
  stoppedCount: number;
  cpuPercent: number;
  memoryPercent: number;
  memoryBytes: number;
}

export interface DashboardResources {
  fleetCpuPercent: number;
  fleetMemoryPercent: number;
  topStacks: StackResourceUsage[];
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

export function useDashboardResources(topN: number = 10) {
  const { interval, enabled } = useAutoRefresh(30);
  const hasToken = hasAuthToken();

  return useQuery<DashboardResources>({
    queryKey: ['dashboard', 'resources', topN],
    queryFn: () => api.get<DashboardResources>(`/api/dashboard/resources?topN=${topN}`),
    enabled: hasToken,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? interval * 1000 : false,
  });
}
