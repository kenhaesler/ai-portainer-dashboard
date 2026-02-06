import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('incident-store');

export interface Incident {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'active' | 'resolved';
  root_cause_insight_id: string | null;
  related_insight_ids: string; // JSON array
  affected_containers: string; // JSON array
  endpoint_id: number | null;
  endpoint_name: string | null;
  correlation_type: string;
  correlation_confidence: 'high' | 'medium' | 'low';
  insight_count: number;
  summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface IncidentInsert {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  root_cause_insight_id: string | null;
  related_insight_ids: string[];
  affected_containers: string[];
  endpoint_id: number | null;
  endpoint_name: string | null;
  correlation_type: string;
  correlation_confidence: 'high' | 'medium' | 'low';
  insight_count: number;
  summary: string | null;
}

export function insertIncident(incident: IncidentInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO incidents (
      id, title, severity, status, root_cause_insight_id,
      related_insight_ids, affected_containers, endpoint_id, endpoint_name,
      correlation_type, correlation_confidence, insight_count, summary,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    incident.id,
    incident.title,
    incident.severity,
    incident.root_cause_insight_id,
    JSON.stringify(incident.related_insight_ids),
    JSON.stringify(incident.affected_containers),
    incident.endpoint_id,
    incident.endpoint_name,
    incident.correlation_type,
    incident.correlation_confidence,
    incident.insight_count,
    incident.summary,
  );

  log.debug({ incidentId: incident.id, insightCount: incident.insight_count }, 'Incident created');
}

export function addInsightToIncident(incidentId: string, insightId: string, containerName?: string): void {
  const db = getDb();
  const incident = db.prepare('SELECT related_insight_ids, affected_containers, insight_count, severity FROM incidents WHERE id = ?')
    .get(incidentId) as Incident | undefined;

  if (!incident) return;

  const relatedIds: string[] = JSON.parse(incident.related_insight_ids);
  if (!relatedIds.includes(insightId)) {
    relatedIds.push(insightId);
  }

  const containers: string[] = JSON.parse(incident.affected_containers);
  if (containerName && !containers.includes(containerName)) {
    containers.push(containerName);
  }

  db.prepare(`
    UPDATE incidents
    SET related_insight_ids = ?, affected_containers = ?,
        insight_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    JSON.stringify(relatedIds),
    JSON.stringify(containers),
    relatedIds.length + 1, // +1 for the root cause
    incidentId,
  );
}

export interface GetIncidentsOptions {
  status?: 'active' | 'resolved';
  severity?: string;
  limit?: number;
  offset?: number;
}

export function getIncidents(options: GetIncidentsOptions = {}): Incident[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options.severity) {
    conditions.push('severity = ?');
    params.push(options.severity);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return db.prepare(`
    SELECT * FROM incidents ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Incident[];
}

export function getIncident(id: string): Incident | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Incident | undefined;
}

export function getActiveIncidentForContainer(
  containerId: string,
  withinMinutes: number,
): Incident | undefined {
  const db = getDb();
  // Find an active incident that includes this container and was created recently
  const incidents = db.prepare(`
    SELECT * FROM incidents
    WHERE status = 'active'
      AND created_at >= datetime('now', ? || ' minutes')
    ORDER BY created_at DESC
  `).all(`-${withinMinutes}`) as Incident[];

  // Check if any incident's affected containers or related insights reference this container
  for (const incident of incidents) {
    if (incident.endpoint_id !== null) {
      // Check related insights for matching container
      const relatedIds: string[] = JSON.parse(incident.related_insight_ids);
      const rootId = incident.root_cause_insight_id;
      const allIds = rootId ? [rootId, ...relatedIds] : relatedIds;

      if (allIds.length === 0) continue;

      const placeholders = allIds.map(() => '?').join(',');
      const match = db.prepare(`
        SELECT 1 FROM insights
        WHERE id IN (${placeholders}) AND container_id = ?
        LIMIT 1
      `).get(...allIds, containerId);

      if (match) return incident;
    }
  }

  return undefined;
}

export function resolveIncident(id: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE incidents SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  log.info({ incidentId: id }, 'Incident resolved');
}

export function getIncidentCount(): { active: number; resolved: number; total: number } {
  const db = getDb();
  const active = (db.prepare("SELECT COUNT(*) as count FROM incidents WHERE status = 'active'").get() as { count: number }).count;
  const resolved = (db.prepare("SELECT COUNT(*) as count FROM incidents WHERE status = 'resolved'").get() as { count: number }).count;
  return { active, resolved, total: active + resolved };
}
