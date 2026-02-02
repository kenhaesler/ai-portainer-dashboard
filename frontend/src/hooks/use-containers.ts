import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  endpointId: number;
  endpointName: string;
  ports: Array<{
    private: number;
    public?: number;
    type: string;
  }>;
  created: number;
  labels: Record<string, string>;
  networks: string[];
  healthStatus?: string;
}

interface ContainerActionParams {
  endpointId: number;
  containerId: string;
  action: 'start' | 'stop' | 'restart';
}

export function useContainers(endpointId?: number) {
  return useQuery<Container[]>({
    queryKey: ['containers', endpointId],
    queryFn: async () => {
      const path = endpointId
        ? `/api/containers?endpointId=${endpointId}`
        : '/api/containers';
      return api.get<Container[]>(path);
    },
  });
}

export function useContainerAction() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ContainerActionParams, { previousContainers: Container[] | undefined }>({
    mutationFn: async ({ endpointId, containerId, action }) => {
      await api.post(`/api/containers/${endpointId}/${containerId}/${action}`);
    },
    onMutate: async ({ endpointId, containerId, action }) => {
      await queryClient.cancelQueries({ queryKey: ['containers', endpointId] });
      await queryClient.cancelQueries({ queryKey: ['containers', undefined] });

      const previousContainers = queryClient.getQueryData<Container[]>(['containers', endpointId])
        ?? queryClient.getQueryData<Container[]>(['containers', undefined]);

      const targetState = action === 'stop' ? 'stopped' : 'running';

      const updateContainers = (old: Container[] | undefined) => {
        if (!old) return old;
        return old.map((container) =>
          container.id === containerId
            ? { ...container, state: targetState }
            : container
        );
      };

      queryClient.setQueryData<Container[]>(['containers', endpointId], updateContainers);
      queryClient.setQueryData<Container[]>(['containers', undefined], updateContainers);

      return { previousContainers };
    },
    onError: (error, { endpointId, action }, context) => {
      if (context?.previousContainers) {
        queryClient.setQueryData(['containers', endpointId], context.previousContainers);
        queryClient.setQueryData(['containers', undefined], context.previousContainers);
      }
      toast.error(`Failed to ${action} container`, {
        description: error.message,
      });
    },
    onSuccess: (_data, { endpointId, action, containerId }) => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Container ${action} successful`, {
        description: `Container ${containerId.slice(0, 12)} has been ${action}ed.`,
      });
    },
  });
}
