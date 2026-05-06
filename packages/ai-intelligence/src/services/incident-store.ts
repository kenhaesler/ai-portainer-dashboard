import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('incident-store');

export interface Incident {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'active' | 'resolved';
  root_cause_insight_id: string | null;
  related_insight_ids: string[]; // JSONB returns native array (pg driver auto-parses)
  affected_containers: string[]; // JSONB returns native array (pg driver auto-parses)
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
  signature: string;
}

export async function insertIncident(incident: IncidentInsert): Promise<void> {
  const db = getDbForDomain('incidents');
  await db.execute(`
    INSERT INTO incidents (
      id, title, severity, status, root_cause_insight_id,
      related_insight_ids, affected_containers, endpoint_id, endpoint_name,
      correlation_type, correlation_confidence, insight_count, summary, signature,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
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
    incident.signature,
  ]);

  log.debug({ incidentId: incident.id, insightCount: incident.insight_count }, 'Incident created');
}

export async function addInsightToIncident(incidentId: string, insightId: string, containerName?: string): Promise<void> {
  const db = getDbForDomain('incidents');
  const incident = await db.queryOne<Incident>('SELECT related_insight_ids, affected_containers, insight_count, severity FROM incidents WHERE id = ?', [incidentId]);

  if (!incident) return;

  const relatedIds: string[] = incident.related_insight_ids;
  if (!relatedIds.includes(insightId)) {
    relatedIds.push(insightId);
  }

  const containers: string[] = incident.affected_containers;
  if (containerName && !containers.includes(containerName)) {
    containers.push(containerName);
  }

  await db.execute(`
    UPDATE incidents
    SET related_insight_ids = ?, affected_containers = ?,
        insight_count = ?, updated_at = NOW()
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
  signature?: string;
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
  if (options.signature) {
    conditions.push('signature = ?');
    params.push(options.signature);
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
      AND created_at >= NOW() + (? || ' minutes')::INTERVAL
    ORDER BY created_at DESC
  `, [`-${withinMinutes}`]);

  // Check if any incident's affected containers or related insights reference this container
  for (const incident of incidents) {
    if (incident.endpoint_id !== null) {
      // Check related insights for matching container
      const relatedIds: string[] = incident.related_insight_ids;
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
    UPDATE incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
    WHERE id = ?
  `, [id]);
  log.info({ incidentId: id }, 'Incident resolved');
}

import { signatureLabel } from './signature.js';

const TOP_CONTAINERS_PER_GROUP = 10;
const ALL_NAMES_CAP = 500;

export interface IncidentGroupsOptions {
  status?: 'active' | 'resolved';
  endpoint_id?: number;
  since_minutes?: number;
  severity?: 'critical' | 'warning' | 'info';
}

export interface IncidentGroup {
  signature: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  incident_count: number;
  container_count: number;
  alert_count: number;
  earliest_at: string;
  latest_update_at: string;
  top_containers: Array<{
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
  }>;
  all_container_names: string[];
  names_truncated: boolean;
}

export interface IncidentGroupsResult {
  groups: IncidentGroup[];
  endpoint_facets: Array<{
    endpoint_id: number | null;
    endpoint_name: string | null;
    incident_count: number;
  }>;
  total_active: number;
}

export async function getIncidentGroups(options: IncidentGroupsOptions = {}): Promise<IncidentGroupsResult> {
  const db = getDbForDomain('incidents');
  const where: string[] = ['signature IS NOT NULL'];
  const params: unknown[] = [];
  if (options.status) { where.push('status = ?'); params.push(options.status); }
  if (options.endpoint_id !== undefined) { where.push('endpoint_id = ?'); params.push(options.endpoint_id); }
  if (options.since_minutes) {
    where.push("updated_at >= NOW() + (? || ' minutes')::INTERVAL");
    params.push(`-${options.since_minutes}`);
  }
  if (options.severity) { where.push('severity = ?'); params.push(options.severity); }
  const whereSQL = `WHERE ${where.join(' AND ')}`;

  // 1. Per-signature aggregate — counts, severity rollup, and name list (capped)
  // We keep the incident-level aggregates (incident_count, alert_count, severity, timestamps)
  // separate from the container expansion to avoid double-counting insight_count.
  const rawGroups = await db.query<{
    signature: string;
    severity: 'critical' | 'warning' | 'info';
    incident_count: number;
    alert_count: number;
    earliest_at: string;
    latest_update_at: string;
    container_count: number;
    all_names: string[];
  }>(`
    WITH base AS (
      SELECT id, signature, severity, insight_count, created_at, updated_at, affected_containers
      FROM incidents ${whereSQL}
    ),
    per_incident AS (
      SELECT signature,
             BOOL_OR(severity = 'critical') AS has_critical,
             BOOL_OR(severity = 'warning')  AS has_warning,
             COUNT(*)::int                  AS incident_count,
             COALESCE(SUM(insight_count), 0)::int AS alert_count,
             MIN(created_at)::text          AS earliest_at,
             MAX(updated_at)::text          AS latest_update_at
      FROM base
      GROUP BY signature
    ),
    per_container AS (
      SELECT b.signature,
             COUNT(DISTINCT e.container_name)::int AS container_count,
             (ARRAY(
               SELECT DISTINCT e2.container_name
               FROM base b2
               CROSS JOIN LATERAL jsonb_array_elements_text(b2.affected_containers) AS e2(container_name)
               WHERE b2.signature = b.signature
               ORDER BY e2.container_name
               LIMIT ${ALL_NAMES_CAP}
             )) AS all_names
      FROM base b
      CROSS JOIN LATERAL jsonb_array_elements_text(b.affected_containers) AS e(container_name)
      GROUP BY b.signature
    )
    SELECT
      p.signature,
      CASE WHEN p.has_critical THEN 'critical'
           WHEN p.has_warning  THEN 'warning'
           ELSE 'info' END     AS severity,
      p.incident_count,
      p.alert_count,
      p.earliest_at,
      p.latest_update_at,
      COALESCE(c.container_count, 0) AS container_count,
      COALESCE(c.all_names, '{}')    AS all_names
    FROM per_incident p
    LEFT JOIN per_container c ON c.signature = p.signature
    ORDER BY (CASE WHEN p.has_critical THEN 0 WHEN p.has_warning THEN 1 ELSE 2 END),
             p.incident_count DESC
  `, params);

  // 2. Top-N containers per signature, ordered by severity then recency
  const rawTop = await db.query<{
    signature: string; incident_id: string; container_name: string;
    endpoint_id: number | null; endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info'; created_at: string; rn: number;
  }>(`
    WITH base AS (
      SELECT id, signature, severity, endpoint_id, endpoint_name, created_at, affected_containers
      FROM incidents ${whereSQL}
    ),
    expanded AS (
      SELECT b.id AS incident_id, b.signature, b.severity, b.endpoint_id, b.endpoint_name,
             b.created_at, e.container_name
      FROM base b
      CROSS JOIN LATERAL jsonb_array_elements_text(b.affected_containers) AS e(container_name)
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY signature
               ORDER BY (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                        created_at DESC
             ) AS rn
      FROM expanded
    )
    SELECT signature, incident_id, container_name, endpoint_id, endpoint_name,
           severity, created_at::text, rn
    FROM ranked
    WHERE rn <= ${TOP_CONTAINERS_PER_GROUP}
  `, params);

  // 3. Endpoint facets
  const rawFacets = await db.query<{ endpoint_id: number | null; endpoint_name: string | null; incident_count: number }>(`
    SELECT endpoint_id, endpoint_name, COUNT(*)::int AS incident_count
    FROM incidents ${whereSQL}
    GROUP BY endpoint_id, endpoint_name
    ORDER BY incident_count DESC
  `, params);

  // 4. Stitch top_containers per signature
  const topBySig = new Map<string, IncidentGroup['top_containers']>();
  for (const r of rawTop) {
    const arr = topBySig.get(r.signature) ?? [];
    arr.push({
      incident_id: r.incident_id, container_name: r.container_name,
      endpoint_id: r.endpoint_id, endpoint_name: r.endpoint_name,
      severity: r.severity, created_at: r.created_at,
    });
    topBySig.set(r.signature, arr);
  }

  const groups: IncidentGroup[] = rawGroups.map((g) => ({
    signature: g.signature,
    label: signatureLabel(g.signature),
    severity: g.severity,
    incident_count: g.incident_count,
    container_count: g.container_count,
    alert_count: g.alert_count,
    earliest_at: g.earliest_at,
    latest_update_at: g.latest_update_at,
    top_containers: topBySig.get(g.signature) ?? [],
    all_container_names: g.all_names ?? [],
    names_truncated: (g.all_names?.length ?? 0) >= ALL_NAMES_CAP && g.container_count > ALL_NAMES_CAP,
  }));

  const total_active = rawGroups.reduce((sum, g) => sum + g.incident_count, 0);

  return { groups, endpoint_facets: rawFacets, total_active };
}

export async function getIncidentCount(): Promise<{ active: number; resolved: number; total: number }> {
  const db = getDbForDomain('incidents');
  const activeRow = await db.queryOne<{ count: number }>("SELECT COUNT(*)::integer as count FROM incidents WHERE status = 'active'");
  const resolvedRow = await db.queryOne<{ count: number }>("SELECT COUNT(*)::integer as count FROM incidents WHERE status = 'resolved'");
  const active = activeRow?.count ?? 0;
  const resolved = resolvedRow?.count ?? 0;
  return { active, resolved, total: active + resolved };
}

export interface BatchResolveResult {
  resolved: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Resolves multiple incidents in their own per-id transactions.
 *
 * Failures of individual ids do NOT roll back already-resolved ones —
 * each id is its own atomic operation. Per-id errors are surfaced in
 * `failed[]` rather than aborting the whole batch.
 */
export async function resolveIncidentsBatch(ids: string[]): Promise<BatchResolveResult> {
  const result: BatchResolveResult = { resolved: [], failed: [] };
  const db = getDbForDomain('incidents');
  for (const id of ids) {
    try {
      const before = await db.queryOne<{ id: string }>('SELECT id FROM incidents WHERE id = ?', [id]);
      if (!before) {
        result.failed.push({ id, error: 'not found' });
        continue;
      }
      await resolveIncident(id);
      result.resolved.push(id);
    } catch (err) {
      result.failed.push({ id, error: err instanceof Error ? err.message : 'unknown' });
    }
  }
  return result;
}
