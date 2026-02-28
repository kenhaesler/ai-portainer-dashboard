import { useResource } from '@/shared/hooks/use-resource';
import { STALE_TIMES } from '@/shared/lib/query-constants';

export interface DockerImage {
  id: string;
  name: string;
  tags: string[];
  size: number;
  created: number;
  endpointId: number;
  endpointName?: string;
  registry: string;
}

interface UseImagesOptions {
  /** Auto-refresh interval in milliseconds, or false to disable */
  refetchInterval?: number | false;
}

export function useImages(endpointId?: number, options?: UseImagesOptions) {
  const path = endpointId
    ? `/api/images?endpointId=${endpointId}`
    : '/api/images';
  return useResource<DockerImage[]>(['images', endpointId], path, {
    staleTime: STALE_TIMES.LONG,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: options?.refetchInterval ?? false,
  });
}
