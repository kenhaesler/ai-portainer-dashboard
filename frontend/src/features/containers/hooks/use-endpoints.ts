import { useResource } from '@/shared/hooks/use-resource';
import { STALE_TIMES } from '@/shared/lib/query-constants';

export interface EdgeCapabilities {
  exec: boolean;
  realtimeLogs: boolean;
  liveStats: boolean;
  immediateActions: boolean;
}

export interface Endpoint {
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
  edgeMode: 'standard' | 'async' | null;
  snapshotAge: number | null;
  checkInInterval: number | null;
  capabilities: EdgeCapabilities;
  agentVersion?: string;
  lastCheckIn?: number;
}

export function useEndpoints() {
  return useResource<Endpoint[]>(['endpoints'], '/api/endpoints', {
    staleTime: STALE_TIMES.SHORT,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

const FULL_CAPABILITIES: EdgeCapabilities = {
  exec: true,
  realtimeLogs: true,
  liveStats: true,
  immediateActions: true,
};

/**
 * Look up the capabilities of a specific endpoint by ID.
 * Returns full capabilities if the endpoint is not found (safe default).
 */
export function useEndpointCapabilities(endpointId: number | undefined): {
  capabilities: EdgeCapabilities;
  isEdgeAsync: boolean;
  endpoint: Endpoint | undefined;
} {
  const { data: endpoints } = useEndpoints();
  const endpoint = endpoints?.find((ep) => ep.id === endpointId);

  return {
    capabilities: endpoint?.capabilities ?? FULL_CAPABILITIES,
    isEdgeAsync: endpoint?.edgeMode === 'async',
    endpoint,
  };
}
