import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────

export interface PromptProfileFeatureConfig {
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

export interface PromptProfile {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  prompts: Record<string, PromptProfileFeatureConfig>;
  createdAt: string;
  updatedAt: string;
}

interface ProfileListResponse {
  profiles: PromptProfile[];
  activeProfileId: string;
}

export interface PromptExportData {
  version: number;
  exportedAt: string;
  exportedFrom: string;
  profile: string;
  features: Record<string, { systemPrompt: string; model?: string | null; temperature?: number | null }>;
}

export interface ImportPreviewChange {
  status: 'added' | 'modified' | 'unchanged';
  before?: { systemPrompt: string; model?: string | null; temperature?: number | null };
  after: { systemPrompt: string; model?: string | null; temperature?: number | null };
  tokenDelta?: number;
}

export interface ImportPreviewResponse {
  valid: boolean;
  profile: string;
  exportedAt: string;
  exportedFrom: string;
  summary: { added: number; modified: number; unchanged: number };
  featureCount: number;
  changes: Record<string, ImportPreviewChange>;
}

// ── Query Keys ───────────────────────────────────────────────────────

const PROFILE_KEYS = {
  all: ['prompt-profiles'] as const,
  detail: (id: string) => ['prompt-profiles', id] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────

export function usePromptProfiles() {
  return useQuery<ProfileListResponse>({
    queryKey: PROFILE_KEYS.all,
    queryFn: () => api.get<ProfileListResponse>('/api/prompt-profiles'),
    staleTime: 60 * 1000,
  });
}

export function usePromptProfile(id: string | undefined) {
  return useQuery<PromptProfile>({
    queryKey: PROFILE_KEYS.detail(id ?? ''),
    queryFn: () => api.get<PromptProfile>(`/api/prompt-profiles/${id}`),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation<PromptProfile, Error, { name: string; description: string; prompts: Record<string, PromptProfileFeatureConfig> }>({
    mutationFn: async (params) => {
      return api.post<PromptProfile>('/api/prompt-profiles', params);
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      toast.success('Profile created', { description: `"${profile.name}" is ready to use.` });
    },
    onError: (error) => {
      toast.error('Failed to create profile', { description: error.message });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation<PromptProfile, Error, { id: string; name?: string; description?: string; prompts?: Record<string, PromptProfileFeatureConfig> }>({
    mutationFn: async ({ id, ...updates }) => {
      return api.put<PromptProfile>(`/api/prompt-profiles/${id}`, updates);
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.detail(profile.id) });
      toast.success('Profile updated', { description: `"${profile.name}" saved.` });
    },
    onError: (error) => {
      toast.error('Failed to update profile', { description: error.message });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id }) => {
      await api.delete(`/api/prompt-profiles/${id}`);
    },
    onSuccess: (_data, { name }) => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      toast.success('Profile deleted', { description: `"${name}" has been removed.` });
    },
    onError: (error) => {
      toast.error('Failed to delete profile', { description: error.message });
    },
  });
}

export function useDuplicateProfile() {
  const queryClient = useQueryClient();

  return useMutation<PromptProfile, Error, { sourceId: string; name: string }>({
    mutationFn: async ({ sourceId, name }) => {
      return api.post<PromptProfile>(`/api/prompt-profiles/${sourceId}/duplicate`, { name });
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      toast.success('Profile duplicated', { description: `"${profile.name}" created from copy.` });
    },
    onError: (error) => {
      toast.error('Failed to duplicate profile', { description: error.message });
    },
  });
}

export function useSwitchProfile() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; activeProfileId: string }, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      return api.post<{ success: boolean; activeProfileId: string }>('/api/prompt-profiles/switch', { id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => {
      toast.error('Failed to switch profile', { description: error.message });
    },
  });
}

// ── Export / Import ─────────────────────────────────────────────────

export function useExportProfile() {
  return useMutation<void, Error, { profileId?: string }>({
    mutationFn: async ({ profileId }) => {
      const params = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
      const token = api.getToken();
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${baseUrl}/api/prompt-profiles/export${params}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error ?? `Export failed: HTTP ${response.status}`);
      }
      const disposition = response.headers.get('Content-Disposition');
      const filenameMatch = disposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? 'prompts-export.json';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast.success('Profile exported', { description: 'JSON file downloaded.' });
    },
    onError: (error) => {
      toast.error('Failed to export profile', { description: error.message });
    },
  });
}

export function useImportPreview() {
  return useMutation<ImportPreviewResponse, Error, PromptExportData>({
    mutationFn: async (data) => {
      return api.post<ImportPreviewResponse>('/api/prompt-profiles/import/preview', data);
    },
    onError: (error) => {
      toast.error('Invalid import file', { description: error.message });
    },
  });
}

export function useImportApply() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; profile: PromptProfile }, Error, PromptExportData>({
    mutationFn: async (data) => {
      return api.post<{ success: boolean; profile: PromptProfile }>('/api/prompt-profiles/import', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Prompts imported', { description: 'All changes applied to active profile.' });
    },
    onError: (error) => {
      toast.error('Failed to import prompts', { description: error.message });
    },
  });
}
