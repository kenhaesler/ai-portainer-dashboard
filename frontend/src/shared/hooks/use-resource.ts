import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

/**
 * Thin wrapper around useQuery for simple GET-based resource fetching.
 * Builds queryFn from a path string and passes through all other options.
 */
export function useResource<T>(
  queryKey: readonly unknown[],
  path: string,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>,
): UseQueryResult<T, Error> {
  return useQuery<T, Error>({
    queryKey,
    queryFn: () => api.get<T>(path),
    ...options,
  });
}
