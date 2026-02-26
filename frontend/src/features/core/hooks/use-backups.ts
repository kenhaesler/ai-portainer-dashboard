import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface BackupFile {
  filename: string;
  size: number;
  created: string;
}

interface BackupListResponse {
  backups: BackupFile[];
}

interface BackupMutationResponse {
  success: boolean;
  filename?: string;
  size?: number;
  message?: string;
}

const backupQueryKey = ['backup', 'files'] as const;

export function useBackups() {
  return useQuery<BackupListResponse>({
    queryKey: backupQueryKey,
    queryFn: () => api.get<BackupListResponse>('/api/backup'),
    staleTime: 60 * 1000,
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupMutationResponse>('/api/backup'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKey });
    },
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.delete<BackupMutationResponse>(`/api/backup/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKey });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.post<BackupMutationResponse>(`/api/backup/${encodeURIComponent(filename)}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupQueryKey });
    },
  });
}

export async function downloadBackup(filename: string): Promise<void> {
  const token = api.getToken();
  const response = await fetch(`/api/backup/${encodeURIComponent(filename)}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to download backup (${response.status})`);
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
