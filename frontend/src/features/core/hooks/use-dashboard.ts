import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { STALE_TIMES } from '@/shared/lib/query-constants';
import { hasAuthToken } from '@/shared/lib/auth-constants';

export interface DashboardKpis {
  endpoints: number;
  endpointsUp: number;
  endpointsDown: number;
  running: number;
  stopped: number;
  healthy: number;
  unhealthy: number;
  total: number;
  stacks: number;
}

export interface NormalizedEndpoint {
  id: number;
  name: string;
  type: number;
  url: string;
  status: 'up' | 'down';
  containersRunning: number;
  containersStopped: number;
  totalContainers: number;
  stackCount: number;
  totalCpu: number;
  totalMemory: number;
  isEdge: boolean;
  agentVersion?: string;
  lastCheckIn?: number;
}

export interface NormalizedContainer {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'stopped' | 'paused' | 'dead' | 'unknown';
  status: string;
  created: number;
  endpointId: number;
  endpointName: string;
  ports: Array<{ private: number; public?: number; type: string }>;
  networks: string[];
  labels: Record<string, string>;
  healthStatus?: string;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  security: {
    totalAudited: number;
    flagged: number;
    ignored: number;
  };
  timestamp: string;
}

/**
 * @deprecated No component consumes this hook — the home page uses
 * `useDashboardFull()` (a single `/api/dashboard/full` request) instead.
 * Kept because `/api/dashboard/summary` remains a public API; removal is
 * tracked separately (#1543). The exported types above are still imported
 * by `use-dashboard-full.ts`.
 */
export function useDashboard() {
  const { interval, enabled } = useAutoRefresh(30);
  const hasToken = hasAuthToken();

  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.get<DashboardSummary>('/api/dashboard/summary'),
    enabled: hasToken,
    staleTime: STALE_TIMES.SHORT,
    refetchInterval: enabled ? interval * 1000 : false,
  });
}
