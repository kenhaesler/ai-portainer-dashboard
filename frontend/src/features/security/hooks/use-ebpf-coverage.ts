import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { usePageVisibility } from '@/hooks/use-page-visibility';

export interface CoverageRecord {
  endpoint_id: number;
  endpoint_name: string;
  status: 'planned' | 'deployed' | 'excluded' | 'failed' | 'unknown' | 'not_deployed' | 'unreachable' | 'incompatible';
  beyla_enabled?: number;
  beyla_container_id?: string | null;
  beyla_managed?: number;
  otlp_endpoint_override?: string | null;
  drifted?: boolean;
  exclusion_reason: string | null;
  deployment_profile: string | null;
  last_trace_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoverageSummary {
  total: number;
  deployed: number;
  planned: number;
  excluded: number;
  failed: number;
  unknown: number;
  not_deployed: number;
  unreachable: number;
  incompatible: number;
  coveragePercent: number;
}

export function useEbpfCoverage() {
  const isPageVisible = usePageVisibility();

  return useQuery<{ coverage: CoverageRecord[] }>({
    queryKey: ['ebpf', 'coverage'],
    queryFn: () => api.get('/api/ebpf/coverage'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: isPageVisible ? 120_000 : false,
  });
}

export function useEbpfCoverageSummary() {
  const isPageVisible = usePageVisibility();

  return useQuery<CoverageSummary>({
    queryKey: ['ebpf', 'coverage', 'summary'],
    queryFn: () => api.get('/api/ebpf/coverage/summary'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: isPageVisible ? 120_000 : false,
  });
}

export function useUpdateCoverageStatus() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean },
    Error,
    { endpointId: number; status: string; reason?: string }
  >({
    mutationFn: async ({ endpointId, status, reason }) => {
      return api.put(`/api/ebpf/coverage/${endpointId}`, { status, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      toast.success('Coverage status updated');
    },
    onError: (error) => {
      toast.error('Failed to update coverage status', {
        description: error.message,
      });
    },
  });
}

export function useSyncCoverage() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; added: number }, Error>({
    mutationFn: async () => {
      return api.post('/api/ebpf/coverage/sync');
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      toast.success('Endpoints synced', {
        description: `${data.added} new endpoint(s) added.`,
      });
    },
    onError: (error) => {
      toast.error('Sync failed', {
        description: error.message,
      });
    },
  });
}

export function useVerifyCoverage() {
  const queryClient = useQueryClient();

  return useMutation<
    { verified: boolean; lastTraceAt: string | null },
    Error,
    number
  >({
    mutationFn: async (endpointId) => {
      return api.post(`/api/ebpf/coverage/${endpointId}/verify`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      if (data.verified) {
        toast.success('Traces verified', {
          description: `Last trace at ${data.lastTraceAt}`,
        });
      } else {
        toast.warning('No recent traces', {
          description: 'No traces received in the last 10 minutes.',
        });
      }
    },
    onError: (error) => {
      toast.error('Verification failed', {
        description: error.message,
      });
    },
  });
}

export function useDeployBeyla() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; result: { status: string } }, Error, { endpointId: number; otlpEndpoint?: string }>({
    mutationFn: async ({ endpointId, otlpEndpoint }) =>
      api.post(
        `/api/ebpf/deploy/${endpointId}`,
        otlpEndpoint ? { otlpEndpoint } : {},
        { timeoutMs: 60000 },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage', 'summary'] });
      toast.success('Beyla deployed', {
        description: `Action: ${data.result.status}`,
      });
    },
    onError: (error) => {
      toast.error('Deploy failed', { description: error.message });
    },
  });
}

export function useDisableBeyla() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; result: { status: string } }, Error, number>({
    mutationFn: async (endpointId) => api.post(`/api/ebpf/disable/${endpointId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage', 'summary'] });
      toast.success('Beyla disabled');
    },
    onError: (error) => {
      toast.error('Disable failed', { description: error.message });
    },
  });
}

export function useEnableBeyla() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; result: { status: string } }, Error, number>({
    mutationFn: async (endpointId) => api.post(`/api/ebpf/enable/${endpointId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage', 'summary'] });
      toast.success('Beyla enabled');
    },
    onError: (error) => {
      toast.error('Enable failed', { description: error.message });
    },
  });
}

export function useRemoveBeyla() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; result: { status: string } }, Error, { endpointId: number; force?: boolean }>({
    mutationFn: async ({ endpointId, force }) => api.delete(`/api/ebpf/remove/${endpointId}`, { params: { force: !!force } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage', 'summary'] });
      toast.success('Beyla removed');
    },
    onError: (error) => {
      toast.error('Remove failed', { description: error.message });
    },
  });
}

export function useDeleteStaleCoverage() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, number>({
    mutationFn: async (endpointId) => api.delete(`/api/ebpf/coverage/${endpointId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage'] });
      queryClient.invalidateQueries({ queryKey: ['ebpf', 'coverage', 'summary'] });
      toast.success('Stale endpoint removed');
    },
    onError: (error) => {
      toast.error('Failed to remove stale endpoint', { description: error.message });
    },
  });
}
