import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

interface OIDCStatus {
  enabled: boolean;
  authUrl?: string;
  state?: string;
}

export interface OIDCEffectiveRedirectUri {
  redirectUri: string;
  source: 'env' | 'setting' | 'none';
}

export function useOIDCStatus() {
  return useQuery<OIDCStatus>({
    queryKey: ['oidc-status'],
    queryFn: () => api.get<OIDCStatus>('/api/auth/oidc/status'),
    staleTime: 30 * 1000,
    retry: false,
  });
}

export function useOIDCEffectiveRedirectUri() {
  return useQuery<OIDCEffectiveRedirectUri>({
    queryKey: ['oidc-effective-redirect-uri'],
    queryFn: () => api.get<OIDCEffectiveRedirectUri>('/api/auth/oidc/effective-redirect-uri'),
    staleTime: 60 * 1000,
    retry: false,
  });
}
