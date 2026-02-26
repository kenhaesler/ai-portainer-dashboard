import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

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
  return useQuery<DockerImage[]>({
    queryKey: ['images', endpointId],
    queryFn: async () => {
      const path = endpointId
        ? `/api/images?endpointId=${endpointId}`
        : '/api/images';
      return api.get<DockerImage[]>(path);
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: options?.refetchInterval ?? false,
  });
}
