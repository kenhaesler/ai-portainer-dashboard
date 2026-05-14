import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface ServiceMapNode {
  id: string;
  name: string;
  callCount?: number;
  avgDuration?: number;
  errorRate?: number;
}

export interface ServiceMapEdge {
  source: string;
  target: string;
  callCount?: number;
  avgDuration?: number;
  /**
   * Backend currently returns `callCount` only; `errorCount`/`errorRate` is
   * derived from the node level. Consumers should compute per-edge error rate
   * from the matching `target` node's `errorRate` if more nuance is needed.
   */
  errorCount?: number;
}

export interface ServiceMap {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}

export interface UseServiceMapOptions {
  from?: Date;
  to?: Date;
  serviceName?: string;
  endpointId?: number;
}

/**
 * Hook around `GET /api/traces/service-map`.
 *
 * Phase 2 RED-consumer pages (#1233 in particular) need a stable
 * service-scoped wrapper that lets callers pass `Date` objects directly while
 * the older `useServiceMap` in `use-traces.ts` expects pre-serialized ISO
 * strings. This wrapper handles the conversion and is what new code should
 * reach for.
 */
export function useServiceMap(
  opts: UseServiceMapOptions = {},
): UseQueryResult<ServiceMap, Error> {
  const params: Record<string, string | number | boolean | undefined> = {};
  if (opts.from) params.from = opts.from.toISOString();
  if (opts.to) params.to = opts.to.toISOString();
  if (opts.serviceName) params.serviceName = opts.serviceName;
  if (opts.endpointId !== undefined) params.endpointId = opts.endpointId;

  return useQuery<ServiceMap, Error>({
    queryKey: ['traces', 'service-map', params],
    queryFn: () => api.get<ServiceMap>('/api/traces/service-map', { params }),
  });
}
