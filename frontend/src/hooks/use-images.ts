import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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

export function useImages(endpointId?: number) {
  return useQuery<DockerImage[]>({
    queryKey: ['images', endpointId],
    queryFn: async () => {
      const path = endpointId
        ? `/api/images?endpointId=${endpointId}`
        : '/api/images';
      return api.get<DockerImage[]>(path);
    },
    staleTime: 5 * 60 * 1000,
  });
}
