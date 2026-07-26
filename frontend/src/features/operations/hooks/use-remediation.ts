import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { STALE_TIMES } from '@/shared/lib/query-constants';
import { usePageVisibility } from '@/shared/hooks/use-page-visibility';
import { toast } from 'sonner';

interface RemediationAction {
  id: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  containerId: string;
  endpointId: number;
  rationale: string;
  suggestedBy: string;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  result?: string;
}

export function useRemediationActions(status?: string) {
  const isPageVisible = usePageVisibility();

  return useQuery<RemediationAction[]>({
    queryKey: ['remediation', 'actions', status],
    queryFn: () => {
      const params: Record<string, string | undefined> = { status };
      return api.get<RemediationAction[]>('/api/remediation/actions', { params });
    },
    // This query is mounted in multiple places (sidebar + remediation page).
    // Prevent retry/focus bursts that can trigger transient 429 responses.
    retry: false,
    refetchOnReconnect: false,
    staleTime: STALE_TIMES.DEFAULT,
    // Poll for new pending actions so badge counts stay fresh
    refetchInterval: isPageVisible ? 30_000 : false,
  });
}

/**
 * What a mutation needs to identify an action *and* to name it back to the
 * operator. `label` is the human sentence the toast quotes — "Restart Container
 * on api-service". The UUID stays in the URL where it belongs: an operator
 * cannot check a toast that reads
 * "Remediation action 3f2b8c1e-… has been approved" against anything they can
 * see on screen.
 */
export interface RemediationActionRef {
  actionId: string;
  label: string;
}

/** Reject additionally carries the operator's reason, stored as `rejection_reason`. */
export interface RemediationRejectRef extends RemediationActionRef {
  reason?: string;
}

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, RemediationActionRef>({
    mutationFn: async ({ actionId }) => {
      await api.post(`/api/remediation/actions/${actionId}/approve`, {});
    },
    onSuccess: (_data, { label }) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      toast.success('Action approved', {
        description: `${label} is approved. Nothing runs until you press Execute.`,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      if (error.message.toLowerCase().includes('already')) {
        toast.error('Action state changed', {
          description: `${error.message} The list has been refreshed.`,
        });
        return;
      }
      toast.error('Failed to approve action', {
        description: error.message,
      });
    },
  });
}

export function useRejectAction() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, RemediationRejectRef>({
    mutationFn: async ({ actionId, reason }) => {
      const trimmed = reason?.trim();
      await api.post(
        `/api/remediation/actions/${actionId}/reject`,
        trimmed ? { reason: trimmed } : {},
      );
    },
    onSuccess: (_data, { label, reason }) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      const trimmed = reason?.trim();
      toast.success('Action rejected', {
        description: trimmed
          ? `${label} was rejected: ${trimmed}`
          : `${label} was rejected.`,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      if (error.message.toLowerCase().includes('already')) {
        toast.error('Action state changed', {
          description: `${error.message} The list has been refreshed.`,
        });
        return;
      }
      toast.error('Failed to reject action', {
        description: error.message,
      });
    },
  });
}

export function useExecuteAction() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, RemediationActionRef>({
    mutationFn: async ({ actionId }) => {
      await api.post(`/api/remediation/actions/${actionId}/execute`, {});
    },
    onSuccess: (_data, { label }) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      toast.success('Action executed', {
        description: `${label} has run. The row shows the result.`,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      if (error.message.toLowerCase().includes('already')) {
        toast.error('Action state changed', {
          description: `${error.message} The list has been refreshed.`,
        });
        return;
      }
      toast.error('Failed to execute action', {
        description: error.message,
      });
    },
  });
}
