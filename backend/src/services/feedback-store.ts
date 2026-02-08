import { randomUUID } from 'crypto';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('feedback-store');

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
  created_at: string;
}

export interface FeedbackInsert {
  trace_id?: string;
  message_id?: string;
  feature: string;
  rating: 'positive' | 'negative';
  comment?: string;
  user_id: string;
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

export function insertFeedback(data: FeedbackInsert): LlmFeedback {
  const db = getDb();
  const id = randomUUID();
  const effectiveRating = data.rating; // Initially the effective rating equals the user's rating

  db.prepare(`
    INSERT INTO llm_feedback (id, trace_id, message_id, feature, rating, comment, user_id, effective_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.trace_id ?? null,
    data.message_id ?? null,
    data.feature,
    data.rating,
    data.comment ?? null,
    data.user_id,
    effectiveRating,
  );

  log.debug({ id, feature: data.feature, rating: data.rating }, 'Feedback recorded');

  return getFeedbackById(id)!;
}

export function getFeedbackById(id: string): LlmFeedback | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM llm_feedback WHERE id = ?`).get(id) as LlmFeedback | null;
}

export function listFeedback(options: {
  feature?: string;
  rating?: 'positive' | 'negative';
  adminStatus?: string;
  limit?: number;
  offset?: number;
}): { items: LlmFeedback[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.feature) {
    conditions.push('feature = ?');
    params.push(options.feature);
  }
  if (options.rating) {
    conditions.push('rating = ?');
    params.push(options.rating);
  }
  if (options.adminStatus) {
    conditions.push('admin_status = ?');
    params.push(options.adminStatus);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const total = (db.prepare(`SELECT COUNT(*) as count FROM llm_feedback ${where}`).get(...params) as { count: number }).count;
  const items = db.prepare(`SELECT * FROM llm_feedback ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as LlmFeedback[];

  return { items, total };
}

export function adminReviewFeedback(
  feedbackId: string,
  action: 'approved' | 'rejected' | 'overruled',
  reviewerId: string,
  note?: string,
): LlmFeedback | null {
  const db = getDb();
  const existing = getFeedbackById(feedbackId);
  if (!existing) return null;

  let effectiveRating = existing.rating;
  if (action === 'overruled') {
    // Flip the effective rating
    effectiveRating = existing.rating === 'positive' ? 'negative' : 'positive';
  } else if (action === 'rejected') {
    effectiveRating = existing.rating; // Keep original but mark rejected
  }

  db.prepare(`
    UPDATE llm_feedback
    SET admin_status = ?, admin_note = ?, effective_rating = ?, reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(action, note ?? null, effectiveRating, reviewerId, feedbackId);

  log.info({ feedbackId, action, reviewerId }, 'Feedback reviewed');

  return getFeedbackById(feedbackId);
}

export function bulkDeleteFeedback(ids: string[]): number {
  const db = getDb();
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM llm_feedback WHERE id IN (${placeholders})`).run(...ids);
  log.info({ count: result.changes }, 'Bulk deleted feedback');
  return result.changes;
}

// ── Statistics ─────────────────────────────────────────────────────

export function getFeedbackStats(): FeedbackStats[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      feature,
      COUNT(*) as total,
      SUM(CASE WHEN effective_rating = 'positive' THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN effective_rating = 'negative' THEN 1 ELSE 0 END) as negative,
      SUM(CASE WHEN admin_status = 'pending' THEN 1 ELSE 0 END) as pending_count
    FROM llm_feedback
    GROUP BY feature
    ORDER BY total DESC
  `).all() as Array<{
    feature: string;
    total: number;
    positive: number;
    negative: number;
    pending_count: number;
  }>;

  return rows.map(row => ({
    feature: row.feature,
    total: row.total,
    positive: row.positive,
    negative: row.negative,
    satisfactionRate: row.total > 0 ? Math.round((row.positive / row.total) * 100) : 0,
    pendingCount: row.pending_count,
  }));
}

export function getRecentNegativeFeedback(limit: number = 20): LlmFeedback[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM llm_feedback
    WHERE effective_rating = 'negative'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as LlmFeedback[];
}

export function getNegativeFeedbackCount(feature: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM llm_feedback
    WHERE feature = ? AND effective_rating = 'negative'
  `).get(feature) as { count: number };
  return row.count;
}

export function getNegativeFeedbackForFeature(feature: string, limit: number = 50): LlmFeedback[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM llm_feedback
    WHERE feature = ? AND effective_rating = 'negative' AND admin_status != 'rejected'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(feature, limit) as LlmFeedback[];
}

// ── Prompt Suggestions ─────────────────────────────────────────────

export function insertPromptSuggestion(data: {
  feature: string;
  current_prompt: string;
  suggested_prompt: string;
  reasoning: string;
  evidence_feedback_ids: string[];
  negative_count: number;
}): PromptSuggestion {
  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO llm_prompt_suggestions (id, feature, current_prompt, suggested_prompt, reasoning, evidence_feedback_ids, negative_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.feature,
    data.current_prompt,
    data.suggested_prompt,
    data.reasoning,
    JSON.stringify(data.evidence_feedback_ids),
    data.negative_count,
  );

  log.info({ id, feature: data.feature }, 'Prompt suggestion created');
  return getPromptSuggestionById(id)!;
}

export function getPromptSuggestionById(id: string): PromptSuggestion | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM llm_prompt_suggestions WHERE id = ?`).get(id) as
    | (Omit<PromptSuggestion, 'evidence_feedback_ids'> & { evidence_feedback_ids: string })
    | null;
  if (!row) return null;
  return {
    ...row,
    evidence_feedback_ids: JSON.parse(row.evidence_feedback_ids),
  };
}

export function listPromptSuggestions(options?: {
  feature?: string;
  status?: string;
}): PromptSuggestion[] {
  const db = getDb();
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

  const rows = db.prepare(`
    SELECT * FROM llm_prompt_suggestions ${where} ORDER BY created_at DESC
  `).all(...params) as Array<Omit<PromptSuggestion, 'evidence_feedback_ids'> & { evidence_feedback_ids: string }>;

  return rows.map(row => ({
    ...row,
    evidence_feedback_ids: JSON.parse(row.evidence_feedback_ids),
  }));
}

export function updatePromptSuggestionStatus(
  id: string,
  status: 'applied' | 'dismissed' | 'edited',
  userId?: string,
): PromptSuggestion | null {
  const db = getDb();
  const existing = getPromptSuggestionById(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE llm_prompt_suggestions
    SET status = ?, applied_at = datetime('now'), applied_by = ?
    WHERE id = ?
  `).run(status, userId ?? null, id);

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
