import { randomUUID } from 'crypto';
import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('feedback-store');

function db() { return getDbForDomain('feedback'); }

// ── Types ───────────────────────────────────────────────────────────

export interface LlmFeedback {
  id: string;
  trace_id: string | null;
  message_id: string | null;
  feature: string;
  rating: 'positive' | 'negative';
  comment: string | null;
  user_id: string;
  admin_status: 'pending' | 'approved' | 'rejected' | 'overruled';
  admin_note: string | null;
  effective_rating: 'positive' | 'negative' | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  response_preview: string | null;
  user_query: string | null;
  username: string | null;
  created_at: string;
}

export interface FeedbackInsert {
  trace_id?: string;
  message_id?: string;
  feature: string;
  rating: 'positive' | 'negative';
  comment?: string;
  user_id: string;
  response_preview?: string;
  user_query?: string;
}

export interface FeedbackStats {
  feature: string;
  total: number;
  positive: number;
  negative: number;
  satisfactionRate: number;
  pendingCount: number;
}

export interface PromptSuggestion {
  id: string;
  feature: string;
  current_prompt: string;
  suggested_prompt: string;
  reasoning: string;
  evidence_feedback_ids: string[];
  negative_count: number;
  status: 'pending' | 'applied' | 'dismissed' | 'edited';
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
}

// ── Rate Limiting ──────────────────────────────────────────────────

const FEEDBACK_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const FEEDBACK_RATE_LIMIT_MAX = 10; // max 10 feedback submissions per minute per user

const userFeedbackTimestamps = new Map<string, number[]>();

export function checkFeedbackRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = userFeedbackTimestamps.get(userId) ?? [];
  const recentTimestamps = timestamps.filter(t => now - t < FEEDBACK_RATE_LIMIT_WINDOW_MS);

  if (recentTimestamps.length >= FEEDBACK_RATE_LIMIT_MAX) {
    return false; // rate limited
  }

  recentTimestamps.push(now);
  userFeedbackTimestamps.set(userId, recentTimestamps);
  return true;
}

// ── CRUD Operations ────────────────────────────────────────────────

export async function insertFeedback(data: FeedbackInsert): Promise<LlmFeedback> {
  const id = randomUUID();
  const effectiveRating = data.rating; // Initially the effective rating equals the user's rating

  await db().execute(`
    INSERT INTO llm_feedback (id, trace_id, message_id, feature, rating, comment, user_id, effective_rating, response_preview, user_query)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.trace_id ?? null,
    data.message_id ?? null,
    data.feature,
    data.rating,
    data.comment ?? null,
    data.user_id,
    effectiveRating,
    data.response_preview ?? null,
    data.user_query ?? null,
  ]);

  log.debug({ id, feature: data.feature, rating: data.rating }, 'Feedback recorded');

  return (await getFeedbackById(id))!;
}

export async function getFeedbackById(id: string): Promise<LlmFeedback | null> {
  return db().queryOne<LlmFeedback>(`SELECT * FROM llm_feedback WHERE id = ?`, [id]);
}

export async function listFeedback(options: {
  feature?: string;
  rating?: 'positive' | 'negative';
  adminStatus?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: LlmFeedback[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.feature) {
    conditions.push('f.feature = ?');
    params.push(options.feature);
  }
  if (options.rating) {
    conditions.push('f.rating = ?');
    params.push(options.rating);
  }
  if (options.adminStatus) {
    conditions.push('f.admin_status = ?');
    params.push(options.adminStatus);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countRow = await db().queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM llm_feedback f ${where}`, params);
  const total = countRow?.count ?? 0;
  const items = await db().query<LlmFeedback>(`SELECT f.*, u.username FROM llm_feedback f LEFT JOIN users u ON f.user_id = u.id ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

  return { items, total };
}

export async function adminReviewFeedback(
  feedbackId: string,
  action: 'approved' | 'rejected' | 'overruled',
  reviewerId: string,
  note?: string,
): Promise<LlmFeedback | null> {
  const existing = await getFeedbackById(feedbackId);
  if (!existing) return null;

  let effectiveRating = existing.rating;
  if (action === 'overruled') {
    // Flip the effective rating
    effectiveRating = existing.rating === 'positive' ? 'negative' : 'positive';
  } else if (action === 'rejected') {
    effectiveRating = existing.rating; // Keep original but mark rejected
  }

  await db().execute(`
    UPDATE llm_feedback
    SET admin_status = ?, admin_note = ?, effective_rating = ?, reviewed_at = NOW(), reviewed_by = ?
    WHERE id = ?
  `, [action, note ?? null, effectiveRating, reviewerId, feedbackId]);

  log.info({ feedbackId, action, reviewerId }, 'Feedback reviewed');

  return getFeedbackById(feedbackId);
}

export async function bulkDeleteFeedback(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const result = await db().execute(`DELETE FROM llm_feedback WHERE id IN (${placeholders})`, ids);
  log.info({ count: result.changes }, 'Bulk deleted feedback');
  return result.changes;
}

// ── Statistics ─────────────────────────────────────────────────────

export async function getFeedbackStats(): Promise<FeedbackStats[]> {
  const rows = await db().query<{
    feature: string;
    total: number;
    positive: number;
    negative: number;
    pending_count: number;
  }>(`
    SELECT
      feature,
      COUNT(*) as total,
      SUM(CASE WHEN effective_rating = 'positive' THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN effective_rating = 'negative' THEN 1 ELSE 0 END) as negative,
      SUM(CASE WHEN admin_status = 'pending' THEN 1 ELSE 0 END) as pending_count
    FROM llm_feedback
    GROUP BY feature
    ORDER BY total DESC
  `);

  return rows.map(row => ({
    feature: row.feature,
    total: row.total,
    positive: row.positive,
    negative: row.negative,
    satisfactionRate: row.total > 0 ? Math.round((row.positive / row.total) * 100) : 0,
    pendingCount: row.pending_count,
  }));
}

export async function getRecentNegativeFeedback(limit: number = 20): Promise<LlmFeedback[]> {
  return db().query<LlmFeedback>(`
    SELECT f.*, u.username FROM llm_feedback f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE f.effective_rating = 'negative'
    ORDER BY f.created_at DESC
    LIMIT ?
  `, [limit]);
}

export async function getNegativeFeedbackCount(feature: string): Promise<number> {
  const row = await db().queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM llm_feedback
    WHERE feature = ? AND effective_rating = 'negative'
  `, [feature]);
  return row?.count ?? 0;
}

export async function getNegativeFeedbackForFeature(feature: string, limit: number = 50): Promise<LlmFeedback[]> {
  return db().query<LlmFeedback>(`
    SELECT * FROM llm_feedback
    WHERE feature = ? AND effective_rating = 'negative' AND admin_status != 'rejected'
    ORDER BY created_at DESC
    LIMIT ?
  `, [feature, limit]);
}

// ── Prompt Suggestions ─────────────────────────────────────────────

export async function insertPromptSuggestion(data: {
  feature: string;
  current_prompt: string;
  suggested_prompt: string;
  reasoning: string;
  evidence_feedback_ids: string[];
  negative_count: number;
}): Promise<PromptSuggestion> {
  const id = randomUUID();

  await db().execute(`
    INSERT INTO llm_prompt_suggestions (id, feature, current_prompt, suggested_prompt, reasoning, evidence_feedback_ids, negative_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.feature,
    data.current_prompt,
    data.suggested_prompt,
    data.reasoning,
    JSON.stringify(data.evidence_feedback_ids),
    data.negative_count,
  ]);

  log.info({ id, feature: data.feature }, 'Prompt suggestion created');
  return (await getPromptSuggestionById(id))!;
}

export async function getPromptSuggestionById(id: string): Promise<PromptSuggestion | null> {
  const row = await db().queryOne<Omit<PromptSuggestion, 'evidence_feedback_ids'> & { evidence_feedback_ids: string }>(
    `SELECT * FROM llm_prompt_suggestions WHERE id = ?`, [id],
  );
  if (!row) return null;
  return {
    ...row,
    evidence_feedback_ids: JSON.parse(row.evidence_feedback_ids),
  };
}

export async function listPromptSuggestions(options?: {
  feature?: string;
  status?: string;
}): Promise<PromptSuggestion[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.feature) {
    conditions.push('feature = ?');
    params.push(options.feature);
  }
  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await db().query<Omit<PromptSuggestion, 'evidence_feedback_ids'> & { evidence_feedback_ids: string }>(`
    SELECT * FROM llm_prompt_suggestions ${where} ORDER BY created_at DESC
  `, params);

  return rows.map(row => ({
    ...row,
    evidence_feedback_ids: JSON.parse(row.evidence_feedback_ids),
  }));
}

export async function updatePromptSuggestionStatus(
  id: string,
  status: 'applied' | 'dismissed' | 'edited',
  userId?: string,
): Promise<PromptSuggestion | null> {
  const existing = await getPromptSuggestionById(id);
  if (!existing) return null;

  await db().execute(`
    UPDATE llm_prompt_suggestions
    SET status = ?, applied_at = NOW(), applied_by = ?
    WHERE id = ?
  `, [status, userId ?? null, id]);

  return getPromptSuggestionById(id);
}

// ── Feature list for the front-end ────────────────────────────────

const FEEDBACK_FEATURES = [
  'chat_assistant',
  'command_palette',
  'anomaly_explainer',
  'incident_summarizer',
  'log_analyzer',
  'metrics_summary',
  'root_cause',
  'remediation',
  'pcap_analyzer',
  'capacity_forecast',
  'correlation_insights',
] as const;

export function getValidFeatures(): readonly string[] {
  return FEEDBACK_FEATURES;
}

export function isValidFeature(feature: string): boolean {
  return (FEEDBACK_FEATURES as readonly string[]).includes(feature);
}
