import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';
import type { Insight } from '../models/monitoring.js';

const log = createChildLogger('insights-store');

export interface InsightInsert {
  id: string;
  endpoint_id: number | null;
  endpoint_name: string | null;
  container_id: string | null;
  container_name: string | null;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  suggested_action: string | null;
}

export async function insertInsight(insight: InsightInsert): Promise<void> {
  const db = getDbForDomain('insights');
  await db.execute(
    `INSERT INTO insights (
      id, endpoint_id, endpoint_name, container_id, container_name,
      severity, category, title, description, suggested_action,
      is_acknowledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW())`,
    [
      insight.id,
      insight.endpoint_id,
      insight.endpoint_name,
      insight.container_id,
      insight.container_name,
      insight.severity,
      insight.category,
      insight.title,
      insight.description,
      insight.suggested_action,
    ],
  );

  log.debug({ insightId: insight.id, severity: insight.severity }, 'Insight inserted');
}

export interface GetInsightsOptions {
  severity?: string;
  limit?: number;
  offset?: number;
  acknowledged?: boolean;
}

export async function getInsights(options: GetInsightsOptions = {}): Promise<Insight[]> {
  const db = getDbForDomain('insights');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.severity) {
    conditions.push('severity = ?');
    params.push(options.severity);
  }

  if (options.acknowledged !== undefined) {
    conditions.push('is_acknowledged = ?');
    params.push(options.acknowledged);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  return db.query<Insight>(
    `SELECT * FROM insights ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export async function acknowledgeInsight(id: string): Promise<boolean> {
  const db = getDbForDomain('insights');
  const result = await db.execute(
    'UPDATE insights SET is_acknowledged = true WHERE id = ?',
    [id],
  );

  if (result.changes > 0) {
    log.info({ insightId: id }, 'Insight acknowledged');
    return true;
  }
  return false;
}

export async function getRecentInsights(minutes: number, limit: number = 500): Promise<Insight[]> {
  const db = getDbForDomain('insights');
  return db.query<Insight>(
    `SELECT * FROM insights
     WHERE created_at >= NOW() + (? || ' minutes')::INTERVAL
     ORDER BY created_at DESC
     LIMIT ?`,
    [`-${minutes}`, limit],
  );
}

/**
 * Batch insert insights in a single transaction with deduplication.
 * Skips insights where (container_id, category, title) already exists within the last 60 minutes.
 */
export async function insertInsights(insights: InsightInsert[]): Promise<number> {
  if (insights.length === 0) return 0;

  const db = getDbForDomain('insights');

  const insertSQL = `
    INSERT INTO insights (
      id, endpoint_id, endpoint_name, container_id, container_name,
      severity, category, title, description, suggested_action,
      is_acknowledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW())
  `;

  const dedupeSQL = `
    SELECT COUNT(*) as cnt FROM insights
    WHERE container_id = ? AND category = ? AND title = ?
      AND created_at >= NOW() - INTERVAL '60 minutes'
  `;

  const inserted = await db.transaction(async (txDb) => {
    let count = 0;
    for (const insight of insights) {
      // Deduplication check
      if (insight.container_id) {
        const row = await txDb.queryOne<{ cnt: number }>(dedupeSQL, [
          insight.container_id,
          insight.category,
          insight.title,
        ]);
        if (row && row.cnt > 0) {
          log.debug({ containerId: insight.container_id, category: insight.category, title: insight.title }, 'Duplicate insight skipped');
          continue;
        }
      }

      await txDb.execute(insertSQL, [
        insight.id,
        insight.endpoint_id,
        insight.endpoint_name,
        insight.container_id,
        insight.container_name,
        insight.severity,
        insight.category,
        insight.title,
        insight.description,
        insight.suggested_action,
      ]);
      count++;
    }
    return count;
  });

  log.info({ total: insights.length, inserted }, 'Batch insights inserted');
  return inserted;
}

/**
 * Delete insights older than the given number of days.
 * Returns the number of deleted rows.
 */
export async function cleanupOldInsights(retentionDays: number): Promise<number> {
  const db = getDbForDomain('insights');
  const result = await db.execute(
    `DELETE FROM insights WHERE created_at < NOW() + (? || ' days')::INTERVAL`,
    [`-${retentionDays}`],
  );
  return result.changes;
}
