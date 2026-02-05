import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ContainerSearchResult {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  endpointId: number;
  endpointName: string;
}

export interface ImageSearchResult {
  id: string;
  name: string;
  tags: string[];
  size: number;
  created: number;
  endpointId: number;
  endpointName?: string;
  registry: string;
}

export interface StackSearchResult {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: string;
}

export interface LogSearchResult {
  id: string;
  endpointId: number;
  endpointName: string;
  containerId: string;
  containerName: string;
  message: string;
  timestamp?: string;
}

export interface GlobalSearchResponse {
  query: string;
  containers: ContainerSearchResult[];
  images: ImageSearchResult[];
  stacks: StackSearchResult[];
  logs: LogSearchResult[];
}

export function useGlobalSearch(query: string, enabled = true) {
  return useQuery<GlobalSearchResponse>({
    queryKey: ['global-search', query],
    enabled: enabled && query.trim().length >= 2,
    queryFn: async () => api.get<GlobalSearchResponse>('/api/search', {
      params: { query, limit: 8, logLimit: 6 },
    }),
  });
}
