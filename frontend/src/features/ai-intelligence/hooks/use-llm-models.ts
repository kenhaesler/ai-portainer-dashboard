import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface LlmModel {
  name: string;
  size?: number;
  modified?: string;
}

export interface LlmModelsResponse {
  models: LlmModel[];
  default: string;
}

interface LlmTestConnectionRequest {
  url?: string;
  token?: string;
  ollamaUrl?: string;
}

export interface LlmTestConnectionResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

export function useLlmModels(host?: string) {
  const url = host
    ? `/api/llm/models?host=${encodeURIComponent(host)}`
    : '/api/llm/models';
  return useQuery<LlmModelsResponse>({
    queryKey: ['llm-models', host],
    queryFn: () => api.get<LlmModelsResponse>(url),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

// ─── Test Prompt ─────────────────────────────────────────────────────

export interface LlmTestPromptRequest {
  feature: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

export interface LlmTestPromptResponse {
  success: boolean;
  response?: string;
  sampleInput?: string;
  sampleLabel?: string;
  model?: string;
  tokens?: { prompt: number; completion: number; total: number };
  latencyMs?: number;
  format?: 'json' | 'text';
  error?: string;
}

export function useLlmTestPrompt() {
  return useMutation<LlmTestPromptResponse, Error, LlmTestPromptRequest>({
    mutationFn: (body) =>
      api.post<LlmTestPromptResponse>('/api/llm/test-prompt', body),
  });
}

export function useLlmTestConnection() {
  const queryClient = useQueryClient();

  return useMutation<LlmTestConnectionResponse, Error, LlmTestConnectionRequest>({
    mutationFn: (body) =>
      api.post<LlmTestConnectionResponse>('/api/llm/test-connection', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-models'] });
    },
  });
}
