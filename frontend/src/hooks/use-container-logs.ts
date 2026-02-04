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
    queryFn: () => {
      const params: Record<string, string | number | boolean | undefined> = { tail, timestamps, since, until };
      return api.get<ContainerLogsResult>(
        `/api/containers/${endpointId}/${containerId}/logs`,
        { params }
      );
    },
    enabled: Boolean(endpointId) && Boolean(containerId),
  });
}
