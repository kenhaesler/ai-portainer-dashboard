import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  endpointId: number;
  endpointName: string;
  ports: Array<{
    private: number;
    public?: number;
    type: string;
  }>;
  created: number;
  labels: Record<string, string>;
  networks: string[];
  networkIPs?: Record<string, string>;
  healthStatus?: string;
}

export interface PaginatedContainers {
  data: Container[];
  total: number;
  page: number;
  pageSize: number;
}

interface PartialContainersResponse {
  data: Container[];
  partial?: boolean;
  failedEndpoints?: string[];
}

export interface UseContainersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  state?: string;
  endpointId?: number;
}

function normalizeContainersResponse(
  response: Container[] | PartialContainersResponse,
): Container[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  return [];
}

/**
 * Fetch all containers (unpaginated). Backward compatible — returns Container[].
 */
export function useContainers(params?: UseContainersParams) {
  const { endpointId, search, state } = params ?? {};

  return useQuery<Container[]>({
    queryKey: ['containers', { endpointId, search, state }],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (endpointId !== undefined) searchParams.set('endpointId', String(endpointId));
      if (search) searchParams.set('search', search);
      if (state) searchParams.set('state', state);

      const qs = searchParams.toString();
      const path = qs ? `/api/containers?${qs}` : '/api/containers';
      const response = await api.get<Container[] | PartialContainersResponse>(path);
      return normalizeContainersResponse(response);
    },
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch containers with server-side pagination. Returns PaginatedContainers.
 */
export function usePaginatedContainers(params: {
  page: number;
  pageSize: number;
  search?: string;
  state?: string;
  endpointId?: number;
}) {
  const { page, pageSize, search, state, endpointId } = params;

  return useQuery<PaginatedContainers>({
    queryKey: ['containers', 'paginated', { endpointId, page, pageSize, search, state }],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      searchParams.set('pageSize', String(pageSize));
      if (endpointId !== undefined) searchParams.set('endpointId', String(endpointId));
      if (search) searchParams.set('search', search);
      if (state) searchParams.set('state', state);

      return api.get<PaginatedContainers>(`/api/containers?${searchParams.toString()}`);
    },
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

export function useFavoriteContainers(ids: string[]) {
  return useQuery<Container[]>({
    queryKey: ['containers', 'favorites', ids],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const qs = ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&');
      return api.get<Container[]>(`/api/containers/favorites?${qs}`);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: ids.length > 0,
  });
}

export function useContainerCount() {
  return useQuery<{ count: number }>({
    queryKey: ['containers', 'count'],
    queryFn: () => api.get<{ count: number }>('/api/containers/count'),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
