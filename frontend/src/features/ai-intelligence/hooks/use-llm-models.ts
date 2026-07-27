import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useResource } from '@/shared/hooks/use-resource';
import { STALE_TIMES } from '@/shared/lib/query-constants';

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
  authType?: 'bearer' | 'basic';
}

export interface LlmTestConnectionResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

export interface LlmStatus {
  available: boolean;
  disabledReason: string | null;
}

/**
 * Whether a language model is actually reachable.
 *
 * The Assistant offered a model dropdown, a profile picker and four clickable
 * suggested questions on a deployment with no LLM configured, and revealed the
 * problem only after the user sent a message and got a red `Error:` pill — the
 * page could not tell you it was broken until you used it.
 *
 * `retry: false`, so a failed request is not retried and leaves `data` at the
 * same `undefined` an in-flight request has. Consumers that gate an
 * affordance on this must read `isError` as well: without it, "the check
 * failed" is indistinguishable from "the check has not finished", and only
 * one of those is bounded by a round trip.
 */
export function useLlmStatus() {
  return useQuery<LlmStatus>({
    queryKey: ['llm', 'status'],
    queryFn: () => api.get<LlmStatus>('/api/llm/status'),
    staleTime: 30_000,
    retry: false,
  });
}

export function useLlmModels(host?: string) {
  const path = host
    ? `/api/llm/models?host=${encodeURIComponent(host)}`
    : '/api/llm/models';
  return useResource<LlmModelsResponse>(['llm-models', host], path, {
    staleTime: STALE_TIMES.LONG,
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
