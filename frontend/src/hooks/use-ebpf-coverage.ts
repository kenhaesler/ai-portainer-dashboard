import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface CoverageRecord {
  endpoint_id: number;
  endpoint_name: string;
  status: 'planned' | 'deployed' | 'excluded' | 'failed' | 'unknown' | 'not_deployed' | 'unreachable' | 'incompatible';
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
  return useQuery<{ coverage: CoverageRecord[] }>({
    queryKey: ['ebpf', 'coverage'],
    queryFn: () => api.get('/api/ebpf/coverage'),
    refetchInterval: 30_000,
  });
}

export function useEbpfCoverageSummary() {
  return useQuery<CoverageSummary>({
    queryKey: ['ebpf', 'coverage', 'summary'],
    queryFn: () => api.get('/api/ebpf/coverage/summary'),
    refetchInterval: 30_000,
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
