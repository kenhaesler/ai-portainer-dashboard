import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

interface OIDCStatus {
  enabled: boolean;
  authUrl?: string;
  state?: string;
}

export function useOIDCStatus() {
  return useQuery<OIDCStatus>({
    queryKey: ['oidc-status'],
    queryFn: () => api.get<OIDCStatus>('/api/auth/oidc/status'),
    staleTime: 30 * 1000,
    retry: false,
  });
}
