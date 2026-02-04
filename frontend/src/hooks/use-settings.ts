import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, UpdateSettingParams>({
    mutationFn: async ({ key, value }) => {
      await api.put(`/api/settings/${key}`, { value });
    },
    onSuccess: (_data, { key }) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Setting updated', {
        description: `Setting "${key}" has been updated successfully.`,
      });
    },
    onError: (error, { key }) => {
      toast.error(`Failed to update setting "${key}"`, {
        description: error.message,
      });
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
