import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';
import type { Investigation, InvestigationStatus, InvestigationWithInsight } from '../models/investigation.js';

const log = createChildLogger('investigation-store');

export interface InvestigationInsert {
  id: string;
  insight_id: string;
  endpoint_id: number | null;
  container_id: string | null;
  container_name: string | null;
}

export function insertInvestigation(investigation: InvestigationInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO investigations (
      id, insight_id, endpoint_id, container_id, container_name,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(
    investigation.id,
    investigation.insight_id,
    investigation.endpoint_id,
    investigation.container_id,
    investigation.container_name,
  );

  log.debug({ investigationId: investigation.id }, 'Investigation inserted');
}

export function updateInvestigationStatus(
  id: string,
  status: InvestigationStatus,
  updates?: {
    evidence_summary?: string;
    root_cause?: string;
    contributing_factors?: string;
    severity_assessment?: string;
    recommended_actions?: string;
    confidence_score?: number;
    analysis_duration_ms?: number;
    llm_model?: string;
    ai_summary?: string;
    error_message?: string;
    completed_at?: string;
  },
): void {
  const db = getDb();
  const sets = ['status = ?'];
  const params: unknown[] = [status];

  if (updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        params.push(value);
      }
    }
  }

  params.push(id);

  db.prepare(`UPDATE investigations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  log.debug({ investigationId: id, status }, 'Investigation status updated');
}

export function getInvestigation(id: string): InvestigationWithInsight | undefined {
  const db = getDb();
  return db
    .prepare(`
      SELECT i.*, ins.title as insight_title, ins.severity as insight_severity, ins.category as insight_category
      FROM investigations i
      LEFT JOIN insights ins ON i.insight_id = ins.id
      WHERE i.id = ?
    `)
    .get(id) as InvestigationWithInsight | undefined;
}

export function getInvestigationByInsightId(insightId: string): Investigation | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM investigations WHERE insight_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(insightId) as Investigation | undefined;
}

export interface GetInvestigationsOptions {
  status?: InvestigationStatus;
  container_id?: string;
  limit?: number;
  offset?: number;
}

export function getInvestigations(options: GetInvestigationsOptions = {}): InvestigationWithInsight[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('i.status = ?');
    params.push(options.status);
  }

  if (options.container_id) {
    conditions.push('i.container_id = ?');
    params.push(options.container_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return db
    .prepare(`
      SELECT i.*, ins.title as insight_title, ins.severity as insight_severity, ins.category as insight_category
      FROM investigations i
      LEFT JOIN insights ins ON i.insight_id = ins.id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as InvestigationWithInsight[];
}

export function getRecentInvestigationForContainer(
  containerId: string,
  withinMinutes: number,
): Investigation | undefined {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM investigations
      WHERE container_id = ?
        AND created_at >= datetime('now', ? || ' minutes')
        AND status != 'failed'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(containerId, `-${withinMinutes}`) as Investigation | undefined;
}
