import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface LlmTrace {
  id: number;
  trace_id: string;
  session_id: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: string;
  user_query: string | null;
  response_preview: string | null;
  feedback_score: number | null;
  feedback_text: string | null;
  created_at: string;
}

export interface LlmStats {
  totalQueries: number;
  totalTokens: number;
  avgLatencyMs: number;
  errorRate: number;
  avgFeedbackScore: number | null;
  feedbackCount: number;
  modelBreakdown: Array<{ model: string; count: number; tokens: number }>;
}

function asNumber(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback: string = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeLlmStats(payload: unknown): LlmStats {
  const raw = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const modelBreakdownRaw = raw.modelBreakdown;
  const modelBreakdown = Array.isArray(modelBreakdownRaw)
    ? modelBreakdownRaw.map((entry) => {
      const item = (entry && typeof entry === 'object') ? entry as Record<string, unknown> : {};
      return {
        model: typeof item.model === 'string' ? item.model : 'unknown',
        count: asNumber(item.count),
        tokens: asNumber(item.tokens),
      };
    })
    : [];

  return {
    totalQueries: asNumber(raw.totalQueries),
    totalTokens: asNumber(raw.totalTokens),
    avgLatencyMs: asNumber(raw.avgLatencyMs),
    errorRate: asNumber(raw.errorRate),
    avgFeedbackScore: asNullableNumber(raw.avgFeedbackScore),
    feedbackCount: asNumber(raw.feedbackCount),
    modelBreakdown,
  };
}

function normalizeLlmTraces(payload: unknown): LlmTrace[] {
  if (!Array.isArray(payload)) return [];

  return payload.map((entry, index) => {
    const item = (entry && typeof entry === 'object') ? entry as Record<string, unknown> : {};

    return {
      id: asNumber(item.id, index),
      trace_id: asString(item.trace_id, `trace-${index}`),
      session_id: typeof item.session_id === 'string' ? item.session_id : null,
      model: asString(item.model, 'unknown'),
      prompt_tokens: asNumber(item.prompt_tokens),
      completion_tokens: asNumber(item.completion_tokens),
      total_tokens: asNumber(item.total_tokens),
      latency_ms: asNumber(item.latency_ms),
      status: asString(item.status, 'unknown'),
      user_query: typeof item.user_query === 'string' ? item.user_query : null,
      response_preview: typeof item.response_preview === 'string' ? item.response_preview : null,
      feedback_score: asNullableNumber(item.feedback_score),
      feedback_text: typeof item.feedback_text === 'string' ? item.feedback_text : null,
      created_at: asString(item.created_at, ''),
    };
  });
}

export function useLlmTraces(limit: number = 50) {
  return useQuery<LlmTrace[]>({
    queryKey: ['llm-traces', limit],
    queryFn: async () => normalizeLlmTraces(await api.get<unknown>(`/api/llm/traces?limit=${limit}`)),
    staleTime: 30 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

export function useLlmStats(hours: number = 24) {
  return useQuery<LlmStats>({
    queryKey: ['llm-stats', hours],
    queryFn: async () => normalizeLlmStats(await api.get<unknown>(`/api/llm/stats?hours=${hours}`)),
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}
