import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SecurityAuditEntry {
  containerId: string;
  containerName: string;
  stackName: string | null;
  endpointId: number;
  endpointName: string;
  state: string;
  status: string;
  image: string;
  posture: {
    capAdd: string[];
    privileged: boolean;
    networkMode: string | null;
    pidMode: string | null;
  };
  findings: Array<{
    severity: 'critical' | 'warning' | 'info';
    category: string;
    title: string;
    description: string;
  }>;
  severity: 'critical' | 'warning' | 'info' | 'none';
  ignored: boolean;
}

interface SecurityAuditResponse {
  entries: SecurityAuditEntry[];
}

interface SecurityIgnoreListResponse {
  key: string;
  category: string;
  defaults: string[];
  patterns: string[];
}

export function useSecurityAudit(endpointId?: number) {
  return useQuery<SecurityAuditResponse>({
    queryKey: ['security-audit', endpointId],
    queryFn: () =>
      endpointId
        ? api.get<SecurityAuditResponse>(`/api/security/audit/${endpointId}`)
        : api.get<SecurityAuditResponse>('/api/security/audit'),
    staleTime: 120 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

export function useSecurityIgnoreList() {
  return useQuery<SecurityIgnoreListResponse>({
    queryKey: ['security-ignore-list'],
    queryFn: () => api.get<SecurityIgnoreListResponse>('/api/security/ignore-list'),
  });
}

export function useUpdateSecurityIgnoreList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patterns: string[]) => {
      return api.put('/api/security/ignore-list', { patterns });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-ignore-list'] });
      queryClient.invalidateQueries({ queryKey: ['security-audit'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
  });
}
