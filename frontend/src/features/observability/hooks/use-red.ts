import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export type RedBucket = '1m' | '5m' | '1h';
export type RedGroupBy = 'service' | 'route' | 'container' | 'namespace';

export interface RedRow {
  group: string;
  rate: number;       // req/s
  errorRate: number;  // 0..1
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  callCount: number;
}

export interface RedResult {
  buckets: { bucketStart: string; rows: RedRow[] }[];
  truncated: boolean;
}

export interface UseRedOptions {
  from: Date;
  to: Date;
  bucket: RedBucket;
  groupBy: RedGroupBy;
  service?: string;
  container?: string;
  route?: string;
}

/**
 * Hook around `GET /api/traces/red`.
 *
 * Both `/api/traces/red` and this hook key on absolute ISO timestamps; callers
 * are responsible for stabilising `from`/`to` (e.g. by rounding to the bucket
 * size or memoising) to avoid request storms.
 */
export function useRed(opts: UseRedOptions): UseQueryResult<RedResult, Error> {
  const params: Record<string, string | number | boolean | undefined> = {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    bucket: opts.bucket,
    groupBy: opts.groupBy,
  };
  if (opts.service) params.service = opts.service;
  if (opts.container) params.container = opts.container;
  if (opts.route) params.route = opts.route;

  return useQuery<RedResult, Error>({
    queryKey: ['traces', 'red', params],
    queryFn: () => api.get<RedResult>('/api/traces/red', { params }),
  });
}
