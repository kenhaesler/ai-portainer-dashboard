import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface DiscoveredOidcGroup {
  group_name: string;
  user_count: number;
  last_seen_at: string;
}

interface DiscoveredOidcGroupsResponse {
  groups: DiscoveredOidcGroup[];
}

interface UseDiscoveredOidcGroupsOptions {
  enabled: boolean;
}

const EMPTY: DiscoveredOidcGroup[] = [];

export function useDiscoveredOidcGroups({ enabled }: UseDiscoveredOidcGroupsOptions) {
  const query = useQuery<DiscoveredOidcGroupsResponse>({
    queryKey: ['oidc', 'discovered-groups'],
    queryFn: () => api.get<DiscoveredOidcGroupsResponse>('/api/auth/oidc/discovered-groups'),
    staleTime: 60 * 1000,
    enabled,
    retry: false,
  });

  return {
    ...query,
    data: query.data?.groups ?? EMPTY,
  };
}
