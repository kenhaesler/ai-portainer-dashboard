import { getDbForDomain } from '../db/app-db-router.js';
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

export async function insertIncident(incident: IncidentInsert): Promise<void> {
  const db = getDbForDomain('incidents');
  await db.execute(`
    INSERT INTO incidents (
      id, title, severity, status, root_cause_insight_id,
      related_insight_ids, affected_containers, endpoint_id, endpoint_name,
      correlation_type, correlation_confidence, insight_count, summary,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [
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
  ]);

  log.debug({ incidentId: incident.id, insightCount: incident.insight_count }, 'Incident created');
}

export async function addInsightToIncident(incidentId: string, insightId: string, containerName?: string): Promise<void> {
  const db = getDbForDomain('incidents');
  const incident = await db.queryOne<Incident>('SELECT related_insight_ids, affected_containers, insight_count, severity FROM incidents WHERE id = ?', [incidentId]);

  if (!incident) return;

  const relatedIds: string[] = JSON.parse(incident.related_insight_ids);
  if (!relatedIds.includes(insightId)) {
    relatedIds.push(insightId);
  }

  const containers: string[] = JSON.parse(incident.affected_containers);
  if (containerName && !containers.includes(containerName)) {
    containers.push(containerName);
  }

  await db.execute(`
    UPDATE incidents
    SET related_insight_ids = ?, affected_containers = ?,
        insight_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [
    JSON.stringify(relatedIds),
    JSON.stringify(containers),
    relatedIds.length + 1, // +1 for the root cause
    incidentId,
  ]);
}

export interface GetIncidentsOptions {
  status?: 'active' | 'resolved';
  severity?: string;
  limit?: number;
  offset?: number;
}

export async function getIncidents(options: GetIncidentsOptions = {}): Promise<Incident[]> {
  const db = getDbForDomain('incidents');
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

  return db.query<Incident>(`
    SELECT * FROM incidents ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}

export async function getIncident(id: string): Promise<Incident | null> {
  const db = getDbForDomain('incidents');
  return db.queryOne<Incident>('SELECT * FROM incidents WHERE id = ?', [id]);
}

export async function getActiveIncidentForContainer(
  containerId: string,
  withinMinutes: number,
): Promise<Incident | undefined> {
  const db = getDbForDomain('incidents');
  // Find an active incident that includes this container and was created recently
  const incidents = await db.query<Incident>(`
    SELECT * FROM incidents
    WHERE status = 'active'
      AND created_at >= datetime('now', ? || ' minutes')
    ORDER BY created_at DESC
  `, [`-${withinMinutes}`]);

  // Check if any incident's affected containers or related insights reference this container
  for (const incident of incidents) {
    if (incident.endpoint_id !== null) {
      // Check related insights for matching container
      const relatedIds: string[] = JSON.parse(incident.related_insight_ids);
      const rootId = incident.root_cause_insight_id;
      const allIds = rootId ? [rootId, ...relatedIds] : relatedIds;

      if (allIds.length === 0) continue;

      const placeholders = allIds.map(() => '?').join(',');
      const match = await db.queryOne(`
        SELECT 1 FROM insights
        WHERE id IN (${placeholders}) AND container_id = ?
        LIMIT 1
      `, [...allIds, containerId]);

      if (match) return incident;
    }
  }

  return undefined;
}

export async function resolveIncident(id: string): Promise<void> {
  const db = getDbForDomain('incidents');
  await db.execute(`
    UPDATE incidents SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `, [id]);
  log.info({ incidentId: id }, 'Incident resolved');
}

export async function getIncidentCount(): Promise<{ active: number; resolved: number; total: number }> {
  const db = getDbForDomain('incidents');
  const activeRow = await db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM incidents WHERE status = 'active'");
  const resolvedRow = await db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM incidents WHERE status = 'resolved'");
  const active = activeRow?.count ?? 0;
  const resolved = resolvedRow?.count ?? 0;
  return { active, resolved, total: active + resolved };
}
