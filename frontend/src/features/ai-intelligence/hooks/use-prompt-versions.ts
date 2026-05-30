import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVersion {
  id: number;
  feature: string;
  version: number;
  systemPrompt: string;
  model: string | null;
  temperature: number | null;
  changedBy: string;
  changedAt: string;
  changeNote: string | null;
}

interface PromptHistoryResponse {
  versions: PromptVersion[];
}

interface RollbackResponse {
  success: boolean;
  newVersion: PromptVersion;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetches the version history for a specific prompt feature.
 * Only queries when `enabled` is true (avoids unnecessary requests when panel is closed).
 */
export function usePromptHistory(feature: string, enabled = true) {
  return useQuery({
    queryKey: ['prompt-history', feature],
    queryFn: () => api.get<PromptHistoryResponse>(`/api/settings/prompts/${feature}/history`),
    enabled: enabled && Boolean(feature),
    staleTime: 30_000,
  });
}

/**
 * Rolls back a prompt feature to a previous version.
 * Invalidates history and settings caches on success.
 */
export function useRollbackPrompt(feature: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (versionId: number) =>
      api.post<RollbackResponse>(`/api/settings/prompts/${feature}/rollback`, { versionId }),
    onSuccess: (data) => {
      toast.success(`Rolled back to v${data.newVersion.version}`);
      // Refresh history panel
      void queryClient.invalidateQueries({ queryKey: ['prompt-history', feature] });
      // Refresh settings so the textarea shows the restored prompt
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      toast.error(`Rollback failed: ${err.message}`);
    },
  });
}
