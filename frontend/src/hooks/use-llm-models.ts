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
