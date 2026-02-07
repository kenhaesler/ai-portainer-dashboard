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
  created_at: string;
}

export interface LlmStats {
  totalQueries: number;
  totalTokens: number;
  avgLatencyMs: number;
  errorRate: number;
  modelBreakdown: Array<{ model: string; count: number; tokens: number }>;
}

export function useLlmTraces(limit: number = 50) {
  return useQuery<LlmTrace[]>({
    queryKey: ['llm-traces', limit],
    queryFn: () => api.get<LlmTrace[]>(`/api/llm/traces?limit=${limit}`),
    staleTime: 30 * 1000,
  });
}

export function useLlmStats(hours: number = 24) {
  return useQuery<LlmStats>({
    queryKey: ['llm-stats', hours],
    queryFn: () => api.get<LlmStats>(`/api/llm/stats?hours=${hours}`),
    staleTime: 60 * 1000,
  });
}
