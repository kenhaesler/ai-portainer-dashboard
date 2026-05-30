/**
 * Hook for the per-user Sensitivity preset (issue #1297).
 *
 * Backs the GET / PUT /api/monitoring/sensitivity endpoints. The PUT
 * mutation is optimistic — the dropdown updates immediately and rolls back
 * on error — so the operator sees the page filter respond without waiting
 * on the network round-trip.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export type SensitivityPreset = 'low' | 'default' | 'high';

interface SensitivityResponse {
  preset: SensitivityPreset;
}

const QUERY_KEY = ['monitoring', 'sensitivity'] as const;

export function useSensitivityPreset() {
  const queryClient = useQueryClient();

  const query = useQuery<SensitivityResponse>({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<SensitivityResponse>('/api/monitoring/sensitivity'),
    // Per-user preference is stable across the session — once loaded it
    // rarely changes outside of the operator clicking the control.
    staleTime: 60_000,
  });

  const mutation = useMutation<SensitivityResponse, Error, SensitivityPreset, { previous: SensitivityResponse | undefined }>({
    mutationFn: (preset) =>
      api.put<SensitivityResponse>('/api/monitoring/sensitivity', { preset }),
    onMutate: async (preset) => {
      // Optimistic update — write the chosen value into the query cache so
      // the dropdown reflects the new preset immediately. If the PUT fails
      // we restore the previous value below.
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<SensitivityResponse>(QUERY_KEY);
      queryClient.setQueryData<SensitivityResponse>(QUERY_KEY, { preset });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(QUERY_KEY, context.previous);
      }
    },
    onSuccess: () => {
      // Invalidate the insights query so the post-filter rerun against
      // the new preset is reflected in the list. Other consumers of
      // /api/monitoring/insights (incident groups, etc.) re-run via the
      // shared query cache.
      queryClient.invalidateQueries({ queryKey: ['monitoring', 'insights'] });
    },
  });

  return {
    preset: query.data?.preset ?? 'default',
    isLoading: query.isLoading,
    setPreset: mutation.mutate,
    isUpdating: mutation.isPending,
    updateError: mutation.error,
  };
}
