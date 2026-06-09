import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

/**
 * Key component versions surfaced in the General → System Information panel.
 * React's version is reported client-side (from `React.version`) and is not
 * part of this payload.
 */
export interface SystemInfo {
  app: string;
  node: string;
  fastify: string;
}

/**
 * Fetch backend component versions. Versions don't change during a session, so
 * the result is cached indefinitely (`staleTime: Infinity`) — no polling.
 */
export function useSystemInfo() {
  return useQuery<SystemInfo>({
    queryKey: ['admin', 'system-info'],
    queryFn: () => api.get<SystemInfo>('/api/admin/system-info'),
    staleTime: Infinity,
  });
}
