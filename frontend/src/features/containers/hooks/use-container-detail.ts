import { useMemo } from 'react';
import { useContainers } from './use-containers';

export function useContainerDetail(endpointId: number, containerId: string) {
  const { data: containers, isError, isLoading, ...rest } = useContainers({ endpointId });

  const container = useMemo(() =>
    containers?.find(c =>
      c.id === containerId || c.id.startsWith(containerId)
    ),
    [containers, containerId]
  );

  return {
    data: container,
    isLoading,
    isError: isError || (!isLoading && !container),
    ...rest
  };
}
