import { getDb } from '../db/sqlite.js';
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

export function insertInsight(insight: InsightInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO insights (
      id, endpoint_id, endpoint_name, container_id, container_name,
      severity, category, title, description, suggested_action,
      is_acknowledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `).run(
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
  );

  log.debug({ insightId: insight.id, severity: insight.severity }, 'Insight inserted');
}

export interface GetInsightsOptions {
  severity?: string;
  limit?: number;
  offset?: number;
  acknowledged?: boolean;
}

export function getInsights(options: GetInsightsOptions = {}): Insight[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.severity) {
    conditions.push('severity = ?');
    params.push(options.severity);
  }

  if (options.acknowledged !== undefined) {
    conditions.push('is_acknowledged = ?');
    params.push(options.acknowledged ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  return db
    .prepare(
      `SELECT * FROM insights ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Insight[];
}

export function acknowledgeInsight(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE insights SET is_acknowledged = 1 WHERE id = ?')
    .run(id);

  if (result.changes > 0) {
    log.info({ insightId: id }, 'Insight acknowledged');
    return true;
  }
  return false;
}

export function getRecentInsights(minutes: number): Insight[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM insights
       WHERE created_at >= datetime('now', ? || ' minutes')
       ORDER BY created_at DESC`,
    )
    .all(`-${minutes}`) as Insight[];
}
