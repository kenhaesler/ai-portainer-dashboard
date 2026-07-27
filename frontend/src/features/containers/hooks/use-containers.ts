import { useQuery } from '@tanstack/react-query';
import type { ContainerState } from '@dashboard/contracts';
import { api } from '@/shared/lib/api';
import { STALE_TIMES } from '@/shared/lib/query-constants';

export interface Container {
  id: string;
  name: string;
  image: string;
  /**
   * The contract vocabulary, not a free string.
   *
   * This was `string`, which is how the fleet-health tile came to compare
   * against `'exited'` — a Docker word the server-side normalizer maps to
   * `'stopped'` before the client ever sees it. A `string` here makes an
   * unreachable comparison look perfectly reasonable to both the compiler and
   * the reviewer. `NormalizedContainerSchema` serializes this field through
   * `ContainerStateSchema`, so the narrowing is a fact about the payload, not
   * an optimistic assertion about it.
   */
  state: ContainerState;
  status: string;
  endpointId: number;
  endpointName: string;
  ports: Array<{
    private: number;
    public?: number;
    type: string;
    /**
     * Docker's host-side bind address (`0.0.0.0`, `127.0.0.1`, `::`, …).
     * Declared by `ContainerPortSchema` in `@dashboard/contracts` and emitted by
     * the normalizer. Undefined when the port is exposed but not published.
     */
    ip?: string;
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
    staleTime: STALE_TIMES.SHORT,
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
    staleTime: STALE_TIMES.SHORT,
  });
}

export function useFavoriteContainers(ids: string[]) {
  return useQuery<Container[]>({
    queryKey: ['containers', 'favorites', ids],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const qs = `ids=${ids.map(encodeURIComponent).join(',')}`;
      return api.get<Container[]>(`/api/containers/favorites?${qs}`);
    },
    staleTime: STALE_TIMES.SHORT,
    enabled: ids.length > 0,
  });
}

export interface ContainerCountSummary {
  total: number;
  byState: Record<string, number>;
}

export function useContainerCount() {
  return useQuery<ContainerCountSummary>({
    queryKey: ['containers', 'count'],
    // GET /api/containers/count returns { total, byState }, not { count }.
    queryFn: () => api.get<ContainerCountSummary>('/api/containers/count'),
    staleTime: STALE_TIMES.SHORT,
  });
}
