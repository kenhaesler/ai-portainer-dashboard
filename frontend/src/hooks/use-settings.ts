import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface Setting {
  key: string;
  value: unknown;
  category: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  updatedAt: string;
  updatedBy?: string;
}

interface UpdateSettingParams {
  key: string;
  value: unknown;
}

interface AuditLogEntry {
  id: string;
  action: string;
  user: string;
  target: string;
  details: string;
  timestamp: string;
  ip?: string;
}

interface AuditLogOptions {
  page?: number;
  limit?: number;
  action?: string;
  user?: string;
  startDate?: string;
  endDate?: string;
}

export function useSettings(category?: string) {
  return useQuery<Setting[]>({
    queryKey: ['settings', category],
    queryFn: () => {
      const params: Record<string, string | undefined> = { category };
      return api.get<Setting[]>('/api/settings', { params });
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, UpdateSettingParams, { previousSettings: unknown }>({
    mutationFn: async ({ key, value }) => {
      await api.put(`/api/settings/${key}`, { value });
    },
    onMutate: async ({ key, value }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['settings'] });

      // Snapshot current value for rollback
      const previousSettings = queryClient.getQueryData(['settings']);

      // Optimistically update the cache
      queryClient.setQueriesData<Setting[]>(
        { queryKey: ['settings'] },
        (old) => {
          if (!old) return old;
          return old.map((s) =>
            s.key === key ? { ...s, value, updatedAt: new Date().toISOString() } : s,
          );
        },
      );

      // Show instant success toast
      toast.success('Setting saved', {
        description: `"${key}" updated.`,
      });

      return { previousSettings };
    },
    onError: (error, { key }, context) => {
      // Rollback to previous value
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings);
      }
      toast.error(`Failed to save "${key}"`, {
        description: error.message,
      });
    },
    onSettled: () => {
      // Refetch to ensure server state is in sync
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useAuditLog(options?: AuditLogOptions) {
  return useQuery<{ entries: AuditLogEntry[]; total: number }>({
    queryKey: ['settings', 'audit-log', options],
    queryFn: () => api.get<{ entries: AuditLogEntry[]; total: number }>(
      '/api/settings/audit-log',
      { params: options as Record<string, string | number | boolean | undefined> }
    ),
  });
}

interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export function useInfiniteAuditLog(options?: Omit<AuditLogOptions, 'page'>) {
  return useInfiniteQuery<AuditLogPage>({
    queryKey: ['settings', 'audit-log', 'infinite', options],
    queryFn: ({ pageParam }) =>
      api.get<AuditLogPage>('/api/settings/audit-log', {
        params: {
          ...options,
          cursor: pageParam,
          limit: options?.limit ?? 100,
        } as Record<string, string | number | boolean | undefined>,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
