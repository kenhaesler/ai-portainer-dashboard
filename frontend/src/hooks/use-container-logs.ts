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

export function useContainerLogs(
  endpointId: number | undefined,
  containerId: string | undefined,
  options: ContainerLogsOptions = {}
) {
  const { tail = 100, since, until, timestamps = true } = options;

  return useQuery<ContainerLogsResult>({
    queryKey: ['container-logs', endpointId, containerId, { tail, since, until, timestamps }],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { tail, timestamps };
      if (since) params.since = since;
      if (until) params.until = until;

      const response = await api.get(
        `/api/containers/${endpointId}/${containerId}/logs`,
        { params }
      );
      return response.data;
    },
    enabled: Boolean(endpointId) && Boolean(containerId),
  });
}
