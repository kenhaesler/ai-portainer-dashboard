import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface PortainerBackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

interface PortainerBackupListResponse {
  backups: PortainerBackupFile[];
}

interface PortainerBackupCreateResponse {
  success: boolean;
  filename: string;
  size: number;
}

const portainerBackupQueryKey = ['portainer-backup', 'files'] as const;

export function usePortainerBackups() {
  return useQuery<PortainerBackupListResponse>({
    queryKey: portainerBackupQueryKey,
    queryFn: () => api.get<PortainerBackupListResponse>('/api/portainer-backup'),
    staleTime: 60 * 1000,
  });
}

export function useCreatePortainerBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password?: string) =>
      api.post<PortainerBackupCreateResponse>('/api/portainer-backup', { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portainerBackupQueryKey });
    },
  });
}

export function useDeletePortainerBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) =>
      api.delete<{ success: boolean }>(`/api/portainer-backup/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portainerBackupQueryKey });
    },
  });
}

export async function downloadPortainerBackup(filename: string): Promise<void> {
  // Routes through ApiClient for shared auth-header/X-Request-ID plumbing and the
  // 401 → auth:expired flow; forces the stored filename as the download name.
  await api.downloadBlob(`/api/portainer-backup/${encodeURIComponent(filename)}`, { filename });
}
