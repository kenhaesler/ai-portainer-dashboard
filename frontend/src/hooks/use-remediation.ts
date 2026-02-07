import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
  result?: string;
}

export function useRemediationActions(status?: string) {
  return useQuery<RemediationAction[]>({
    queryKey: ['remediation', 'actions', status],
    queryFn: () => {
      const params: Record<string, string | undefined> = { status };
      return api.get<RemediationAction[]>('/api/remediation/actions', { params });
    },
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (actionId) => {
      await api.post(`/api/remediation/actions/${actionId}/approve`, {});
    },
    onSuccess: (_data, actionId) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      toast.success('Action approved', {
        description: `Remediation action ${actionId} has been approved.`,
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

  return useMutation<void, Error, string>({
    mutationFn: async (actionId) => {
      await api.post(`/api/remediation/actions/${actionId}/reject`, {});
    },
    onSuccess: (_data, actionId) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      toast.success('Action rejected', {
        description: `Remediation action ${actionId} has been rejected.`,
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

  return useMutation<void, Error, string>({
    mutationFn: async (actionId) => {
      await api.post(`/api/remediation/actions/${actionId}/execute`, {});
    },
    onSuccess: (_data, actionId) => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
      toast.success('Action executed', {
        description: `Remediation action ${actionId} has been executed.`,
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
