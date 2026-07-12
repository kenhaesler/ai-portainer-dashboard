import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { STALE_TIMES } from '@/shared/lib/query-constants';
import { hasAuthToken } from '@/shared/lib/auth-constants';

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

/**
 * @deprecated No component consumes this hook — the home page uses
 * `useDashboardFull()` (a single `/api/dashboard/full` request) instead.
 * Kept because `/api/dashboard/resources` remains a public API; removal is
 * tracked separately (#1543). The exported types above are still imported
 * by `use-dashboard-full.ts`.
 */
export function useDashboardResources(topN: number = 10) {
  const { interval, enabled } = useAutoRefresh(30);
  const hasToken = hasAuthToken();

  return useQuery<DashboardResources>({
    queryKey: ['dashboard', 'resources', topN],
    queryFn: () => api.get<DashboardResources>(`/api/dashboard/resources?topN=${topN}`),
    enabled: hasToken,
    staleTime: STALE_TIMES.SHORT,
    refetchInterval: enabled ? interval * 1000 : false,
  });
}
