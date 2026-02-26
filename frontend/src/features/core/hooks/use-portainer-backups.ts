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
  const token = api.getToken();
  const baseUrl = import.meta.env.VITE_API_URL || '';
  const response = await fetch(`${baseUrl}/api/portainer-backup/${encodeURIComponent(filename)}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to download Portainer backup (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
