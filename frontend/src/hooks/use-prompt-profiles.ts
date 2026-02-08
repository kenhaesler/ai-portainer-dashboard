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
