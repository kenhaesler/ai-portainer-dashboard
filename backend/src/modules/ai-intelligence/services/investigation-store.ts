import { getDbForDomain } from '../../../core/db/app-db-router.js';
import { createChildLogger } from '../../../core/utils/logger.js';
import type { Investigation, InvestigationStatus, InvestigationWithInsight } from '../../../core/models/investigation.js';

const log = createChildLogger('investigation-store');

export interface InvestigationInsert {
  id: string;
  insight_id: string;
  endpoint_id: number | null;
  container_id: string | null;
  container_name: string | null;
}

export async function insertInvestigation(investigation: InvestigationInsert): Promise<void> {
  const db = getDbForDomain('investigations');
  await db.execute(`
    INSERT INTO investigations (
      id, insight_id, endpoint_id, container_id, container_name,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', NOW())
  `, [
    investigation.id,
    investigation.insight_id,
    investigation.endpoint_id,
    investigation.container_id,
    investigation.container_name,
  ]);

  log.debug({ investigationId: investigation.id }, 'Investigation inserted');
}

export async function updateInvestigationStatus(
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
): Promise<void> {
  const db = getDbForDomain('investigations');
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

  await db.execute(`UPDATE investigations SET ${sets.join(', ')} WHERE id = ?`, params);
  log.debug({ investigationId: id, status }, 'Investigation status updated');
}

export async function getInvestigation(id: string): Promise<InvestigationWithInsight | undefined> {
  const db = getDbForDomain('investigations');
  return await db.queryOne<InvestigationWithInsight>(`
    SELECT i.*, ins.title as insight_title, ins.severity as insight_severity, ins.category as insight_category
    FROM investigations i
    LEFT JOIN insights ins ON i.insight_id = ins.id
    WHERE i.id = ?
  `, [id]) ?? undefined;
}

export async function getInvestigationByInsightId(insightId: string): Promise<Investigation | undefined> {
  const db = getDbForDomain('investigations');
  return await db.queryOne<Investigation>(
    'SELECT * FROM investigations WHERE insight_id = ? ORDER BY created_at DESC LIMIT 1',
    [insightId],
  ) ?? undefined;
}

export interface GetInvestigationsOptions {
  status?: InvestigationStatus;
  container_id?: string;
  limit?: number;
  offset?: number;
}

export async function getInvestigations(options: GetInvestigationsOptions = {}): Promise<InvestigationWithInsight[]> {
  const db = getDbForDomain('investigations');
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

  return await db.query<InvestigationWithInsight>(`
    SELECT i.*, ins.title as insight_title, ins.severity as insight_severity, ins.category as insight_category
    FROM investigations i
    LEFT JOIN insights ins ON i.insight_id = ins.id
    ${where}
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}

export async function getRecentInvestigationForContainer(
  containerId: string,
  withinMinutes: number,
): Promise<Investigation | undefined> {
  const db = getDbForDomain('investigations');
  return await db.queryOne<Investigation>(`
    SELECT * FROM investigations
    WHERE container_id = ?
      AND created_at >= NOW() + (? || ' minutes')::INTERVAL
      AND status != 'failed'
    ORDER BY created_at DESC
    LIMIT 1
  `, [containerId, `-${withinMinutes}`]) ?? undefined;
}
