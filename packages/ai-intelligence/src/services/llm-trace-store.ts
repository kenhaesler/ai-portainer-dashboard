import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { batchedDeleteOlderThan } from '@dashboard/core/db/retention.js';
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
  /** Every call in the window, successful or not. */
  totalQueries: number;
  /** Calls that returned `status = 'error'`. */
  failedQueries: number;
  /**
   * Calls the aggregates below are computed over: `totalQueries -
   * failedQueries`. Carried so the UI can state the basis of its own numbers
   * rather than implying they describe every call.
   */
  succeededQueries: number;
  /** Summed over successful calls only. A failed call transfers no tokens. */
  totalTokens: number;
  /**
   * Averaged over successful calls only.
   *
   * This used to average every row, so a call that failed before it left the
   * process contributed the time taken to raise a config error — and the page
   * reported "Avg Latency 69ms" for a model that never received a request.
   */
  avgLatencyMs: number;
  /**
   * Failed share of the window, **already a percentage** (0-100), not a
   * fraction. The frontend multiplied it by 100 a second time and rendered
   * "10000.0%"; the name now says which it is, and `llm-trace-store.test.ts`
   * pins the scale.
   */
  errorRate: number;
  /** Successful calls per model. Errors are excluded, so shares sum over calls a model actually served. */
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

  // Token and latency aggregates are FILTERed to successful calls. A call that
  // errored transferred no tokens and never reached the model, so folding it in
  // reports work that did not happen — one failed call was enough to make this
  // page claim gpt-4o-mini served a request it never received.
  const summary = await db.queryOne<{
    total_queries: number;
    failed_queries: number;
    total_tokens: number;
    avg_latency_ms: number;
    error_rate: number;
  }>(`
    SELECT
      COUNT(*)::integer as total_queries,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::integer, 0) as failed_queries,
      COALESCE(SUM(total_tokens) FILTER (WHERE status <> 'error')::integer, 0) as total_tokens,
      COALESCE(AVG(latency_ms) FILTER (WHERE status <> 'error'), 0) as avg_latency_ms,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0) as error_rate
    FROM llm_traces
    WHERE created_at >= NOW() + (? || ' hours')::INTERVAL
  `, [`-${hoursBack}`]);

  const modelBreakdown = await db.query<{ model: string; count: number; tokens: number }>(`
    SELECT model, COUNT(*)::integer as count, COALESCE(SUM(total_tokens)::integer, 0) as tokens
    FROM llm_traces
    WHERE created_at >= NOW() + (? || ' hours')::INTERVAL
      AND status <> 'error'
    GROUP BY model
    ORDER BY count DESC
  `, [`-${hoursBack}`]);

  const totalQueries = summary?.total_queries ?? 0;
  const failedQueries = summary?.failed_queries ?? 0;

  return {
    totalQueries,
    failedQueries,
    succeededQueries: totalQueries - failedQueries,
    totalTokens: summary?.total_tokens ?? 0,
    avgLatencyMs: Math.round(summary?.avg_latency_ms ?? 0),
    errorRate: Math.round((summary?.error_rate ?? 0) * 100) / 100,
    modelBreakdown,
  };
}

/**
 * Daily retention sweep (#1505). llm_traces stores a row per LLM call —
 * including user_query text and a 500-char response preview — and was never
 * pruned. Batched deletes on idx_llm_traces_created keep the sweep
 * lock-friendly.
 */
export async function cleanOldLlmTraces(days: number): Promise<number> {
  return batchedDeleteOlderThan(getDbForDomain('llm-traces'), 'llm_traces', 'created_at', days);
}
