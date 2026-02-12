import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface ContainerLogsOptions {
  tail?: number;
  since?: string;
  until?: string;
  timestamps?: boolean;
}

interface ContainerLogsResult {
  logs: string;
  container: string;
  endpointId: number;
}

export interface ContainerLogsError {
  message: string;
  code?: 'EDGE_ASYNC_UNSUPPORTED' | 'EDGE_TUNNEL_TIMEOUT' | string;
  status?: number;
}

export function useContainerLogs(
  endpointId: number | undefined,
  containerId: string | undefined,
  options: ContainerLogsOptions = {}
) {
  const { tail = 100, since, until, timestamps = true } = options;

  return useQuery<ContainerLogsResult, ContainerLogsError>({
    queryKey: ['container-logs', endpointId, containerId, { tail, since, until, timestamps }],
    queryFn: () => {
      const params: Record<string, string | number | boolean> = { tail, timestamps };
      if (since) params.since = since;
      if (until) params.until = until;

      return api.get<ContainerLogsResult>(
        `/api/containers/${endpointId}/${containerId}/logs`,
        { params }
      );
    },
    enabled: Boolean(endpointId) && Boolean(containerId),
    // Smart retry: skip for Edge Async (permanent), allow 1 retry for transient errors
    retry: (failureCount, error) => {
      if (error?.code === 'EDGE_ASYNC_UNSUPPORTED') return false;
      return failureCount < 1;
    },
    retryDelay: 3000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
