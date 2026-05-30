import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VulnerabilityRecord {
  id: number;
  cve_id: string;
  severity: string;
  cvss_v3_score: number | null;
  package: string;
  version: string;
  fixed_version: string | null;
  status: string | null;
  description: string | null;
  links: string | null;
  project_id: number;
  repository_name: string;
  digest: string;
  tags: string | null;
  in_use: boolean;
  matching_containers: string | null;
  synced_at: string;
}

export interface VulnerabilitySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  in_use_total: number;
  in_use_critical: number;
  fixable: number;
  excepted: number;
}

export interface VulnerabilityListResponse {
  vulnerabilities: VulnerabilityRecord[];
  summary: VulnerabilitySummary;
}

export interface HarborStatus {
  configured: boolean;
  connected: boolean;
  connectionError?: string;
  lastSync: {
    id: number;
    sync_type: string;
    status: string;
    vulnerabilities_synced: number;
    in_use_matched: number;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
  } | null;
}

export interface ExceptionRecord {
  id: number;
  cve_id: string;
  scope: string;
  scope_ref: string | null;
  justification: string;
  created_by: string;
  approved_by: string | null;
  expires_at: string | null;
  is_active: boolean;
  synced_to_harbor: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export function useHarborStatus() {
  return useQuery<HarborStatus>({
    queryKey: ['harbor-status'],
    queryFn: () => api.get<HarborStatus>('/api/harbor/status'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Lightweight check for sidebar visibility — no connection test. */
export function useHarborEnabled() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ['harbor-enabled'],
    queryFn: () => api.get<{ enabled: boolean }>('/api/harbor/enabled'),
    staleTime: 300_000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useHarborVulnerabilities(options: {
  severity?: string;
  inUse?: boolean;
  cveId?: string;
  repositoryName?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (options.severity) params.set('severity', options.severity);
  if (options.inUse !== undefined) params.set('inUse', String(options.inUse));
  if (options.cveId) params.set('cveId', options.cveId);
  if (options.repositoryName) params.set('repositoryName', options.repositoryName);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const qs = params.toString();

  return useQuery<VulnerabilityListResponse>({
    queryKey: ['harbor-vulnerabilities', options],
    queryFn: () =>
      api.get<VulnerabilityListResponse>(
        `/api/harbor/vulnerabilities${qs ? `?${qs}` : ''}`,
      ),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

export function useHarborVulnerabilitySummary() {
  return useQuery<VulnerabilitySummary>({
    queryKey: ['harbor-vulnerability-summary'],
    queryFn: () => api.get<VulnerabilitySummary>('/api/harbor/vulnerabilities/summary'),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

export function useHarborExceptions(activeOnly = true) {
  return useQuery<ExceptionRecord[]>({
    queryKey: ['harbor-exceptions', activeOnly],
    queryFn: () =>
      api.get<ExceptionRecord[]>(`/api/harbor/exceptions?activeOnly=${activeOnly}`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useTriggerHarborSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post('/api/harbor/sync', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harbor-status'] });
      // Delay refetch to give sync time to populate data
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['harbor-vulnerabilities'] });
        queryClient.invalidateQueries({ queryKey: ['harbor-vulnerability-summary'] });
      }, 5000);
    },
  });
}

export function useCreateException() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      cve_id: string;
      scope?: string;
      scope_ref?: string;
      justification: string;
      expires_at?: string;
    }) => api.post('/api/harbor/exceptions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harbor-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['harbor-vulnerabilities'] });
    },
  });
}

export function useDeactivateException() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/harbor/exceptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['harbor-exceptions'] });
    },
  });
}
