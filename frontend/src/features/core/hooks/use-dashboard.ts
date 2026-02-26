import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';

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
  containersHealthy: number;
  containersUnhealthy: number;
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

export function useDashboard() {
  const { interval, enabled } = useAutoRefresh(30);
  const hasToken = hasAuthToken();

  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.get<DashboardSummary>('/api/dashboard/summary'),
    enabled: hasToken,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? interval * 1000 : false,
  });
}
