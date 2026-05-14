import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';

const log = createChildLogger('insights-store');

/** Minutes within which a duplicate insight is suppressed. */
const DEDUP_WINDOW_MINUTES = 60;

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
  metric_type?: 'cpu' | 'memory' | 'disk' | 'network' | 'restart' | 'latency_p95' | 'error_rate';
  detection_method?: 'threshold' | 'ml-anomaly' | 'prediction' | 'health-check' | 'log-pattern' | 'security-scan';
}

export async function insertInsight(insight: InsightInsert): Promise<void> {
  const db = getDbForDomain('insights');
  await db.execute(
    `INSERT INTO insights (
      id, endpoint_id, endpoint_name, container_id, container_name,
      severity, category, title, description, suggested_action,
      metric_type, detection_method,
      is_acknowledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW())`,
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
      insight.metric_type ?? null,
      insight.detection_method ?? null,
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
 *
 * Within the last 60 minutes, skips insights that match an existing row by:
 * - `(container_id, category, metric_type, detection_method)` when both
 *   structured fields are present (anomaly / threshold / prediction emitters)
 * - `(container_id, category, title)` otherwise (legacy / free-text insights)
 *
 * Returns the set of actually-inserted insight IDs so callers can filter
 * downstream operations.
 */
export async function insertInsights(insights: InsightInsert[]): Promise<Set<string>> {
  if (insights.length === 0) return new Set();

  const db = getDbForDomain('insights');

  const insertSQL = `
    INSERT INTO insights (
      id, endpoint_id, endpoint_name, container_id, container_name,
      severity, category, title, description, suggested_action,
      metric_type, detection_method,
      is_acknowledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW())
  `;

  // Two dedup queries: structured for insights that carry metric_type +
  // detection_method (anomaly, threshold, prediction — title-stable signature),
  // and the legacy title-based key for insights without those columns
  // (security scans, free-text log patterns, ai-analysis findings).
  const dedupeStructuredSQL = `
    SELECT COUNT(*)::integer as cnt FROM insights
    WHERE container_id = ?
      AND category = ?
      AND metric_type = ?
      AND detection_method = ?
      AND created_at >= NOW() - (${DEDUP_WINDOW_MINUTES} || ' minutes')::INTERVAL
  `;

  const dedupeTitleSQL = `
    SELECT COUNT(*)::integer as cnt FROM insights
    WHERE container_id = ?
      AND category = ?
      AND title = ?
      AND created_at >= NOW() - (${DEDUP_WINDOW_MINUTES} || ' minutes')::INTERVAL
  `;

  const insertedIds = await db.transaction(async (txDb) => {
    const ids = new Set<string>();
    for (const insight of insights) {
      // Deduplication check
      if (insight.container_id) {
        const useStructuredKey = Boolean(insight.metric_type && insight.detection_method);
        const row = useStructuredKey
          ? await txDb.queryOne<{ cnt: number }>(dedupeStructuredSQL, [
              insight.container_id,
              insight.category,
              insight.metric_type,
              insight.detection_method,
            ])
          : await txDb.queryOne<{ cnt: number }>(dedupeTitleSQL, [
              insight.container_id,
              insight.category,
              insight.title,
            ]);
        if (row && row.cnt > 0) {
          log.debug({
            containerId: insight.container_id,
            category: insight.category,
            dedupKey: useStructuredKey ? 'structured' : 'title',
          }, 'Duplicate insight skipped');
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
        insight.metric_type ?? null,
        insight.detection_method ?? null,
      ]);
      ids.add(insight.id);
    }
    return ids;
  });

  log.info({ total: insights.length, inserted: insertedIds.size }, 'Batch insights inserted');
  return insertedIds;
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
