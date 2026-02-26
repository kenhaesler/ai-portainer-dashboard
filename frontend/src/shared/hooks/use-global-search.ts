import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useDebouncedValue } from './use-debounced-value';

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

/**
 * Debounced global search hook.
 *
 * Debouncing is handled here so all call sites benefit automatically.
 * The command palette no longer needs to apply its own debounce before
 * calling this hook.
 *
 * @param query    Raw (un-debounced) search query from the input
 * @param enabled  Whether the query is active (e.g. palette is open)
 * @param includeLogs  Whether to include container log results (slow — opt-in)
 * @param debounceMs   How long to wait after the last keystroke before firing
 */
export function useGlobalSearch(
  query: string,
  enabled = true,
  includeLogs = false,
  debounceMs = 300,
) {
  const debouncedQuery = useDebouncedValue(query, debounceMs);

  return useQuery<GlobalSearchResponse>({
    queryKey: ['global-search', debouncedQuery, includeLogs],
    enabled: enabled && debouncedQuery.trim().length >= 2,
    queryFn: async () => api.get<GlobalSearchResponse>('/api/search', {
      params: { query: debouncedQuery, limit: 8, logLimit: 6, includeLogs },
    }),
  });
}
