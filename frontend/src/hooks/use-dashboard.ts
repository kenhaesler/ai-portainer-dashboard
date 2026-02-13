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
  endpoints: NormalizedEndpoint[];
  recentContainers: NormalizedContainer[];
  timestamp: string;
}

export function useDashboard() {
  const { interval, enabled } = useAutoRefresh(30);

  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.get<DashboardSummary>('/api/dashboard/summary'),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? interval * 1000 : false,
  });
}
