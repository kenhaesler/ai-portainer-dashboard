import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('llm-trace-store');

export interface LlmTraceInsert {
  trace_id: string;
  session_id?: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: 'success' | 'error';
  user_query?: string;
  response_preview?: string;
}

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

export async function insertLlmTrace(trace: LlmTraceInsert): Promise<void> {
  const db = getDbForDomain('llm-traces');
  await db.execute(`
    INSERT INTO llm_traces (trace_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, status, user_query, response_preview)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    trace.trace_id,
    trace.session_id ?? null,
    trace.model,
    trace.prompt_tokens,
    trace.completion_tokens,
    trace.total_tokens,
    trace.latency_ms,
    trace.status,
    trace.user_query ?? null,
    trace.response_preview?.slice(0, 500) ?? null,
  ]);
  log.debug({ traceId: trace.trace_id, tokens: trace.total_tokens }, 'LLM trace recorded');
}

export async function getRecentTraces(limit: number = 50): Promise<LlmTrace[]> {
  const db = getDbForDomain('llm-traces');
  return db.query<LlmTrace>(`
    SELECT * FROM llm_traces ORDER BY created_at DESC LIMIT ?
  `, [limit]);
}

export async function getLlmStats(hoursBack: number = 24): Promise<LlmStats> {
  const db = getDbForDomain('llm-traces');

  const summary = await db.queryOne<{
    total_queries: number;
    total_tokens: number;
    avg_latency_ms: number;
    error_rate: number;
  }>(`
    SELECT
      COUNT(*)::integer as total_queries,
      COALESCE(SUM(total_tokens)::integer, 0) as total_tokens,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0) as error_rate
    FROM llm_traces
    WHERE created_at >= NOW() + (? || ' hours')::INTERVAL
  `, [`-${hoursBack}`]);

  const modelBreakdown = await db.query<{ model: string; count: number; tokens: number }>(`
    SELECT model, COUNT(*)::integer as count, COALESCE(SUM(total_tokens)::integer, 0) as tokens
    FROM llm_traces
    WHERE created_at >= NOW() + (? || ' hours')::INTERVAL
    GROUP BY model
    ORDER BY count DESC
  `, [`-${hoursBack}`]);

  return {
    totalQueries: summary?.total_queries ?? 0,
    totalTokens: summary?.total_tokens ?? 0,
    avgLatencyMs: Math.round(summary?.avg_latency_ms ?? 0),
    errorRate: Math.round((summary?.error_rate ?? 0) * 100) / 100,
    modelBreakdown,
  };
}
