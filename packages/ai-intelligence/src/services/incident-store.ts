import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { signatureLabel } from './signature.js';

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
  /** NULL for legacy rows backfilled before signature column was NOT NULL */
  signature: string | null;
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

/**
 * Find an active incident that already covers `(signature, containerId)`.
 *
 * Matches `incidents.signature = ? AND status = 'active' AND containers
 * include containerId` regardless of incident age. The previous version
 * filtered to incidents created within `withinMinutes` (default 5), which
 * caused continuous-emission scenarios (a 1-hour-long anomaly) to spawn
 * dozens of ungrouped singletons after the original incident aged past
 * the window. Fixed in #1195.
 *
 * Returns the most recently updated matching incident if multiple exist
 * (same signature on same container is rare but possible across
 * resolved-then-reopened cycles).
 */
export async function getActiveIncidentForContainer(
  containerId: string,
  signature: string,
): Promise<Incident | undefined> {
  const db = getDbForDomain('incidents');
  const incidents = await db.query<Incident>(`
    SELECT * FROM incidents
    WHERE status = 'active'
      AND signature = ?
      AND affected_containers @> ?::jsonb
    ORDER BY updated_at DESC
    LIMIT 1
  `, [signature, JSON.stringify([containerId])]);

  return incidents[0];
}

export async function resolveIncident(id: string): Promise<void> {
  const db = getDbForDomain('incidents');
  await db.execute(`
    UPDATE incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
    WHERE id = ?
  `, [id]);
  log.info({ incidentId: id }, 'Incident resolved');
}

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
    /** Representative incident (highest-severity, then most-recent) for this container in this group. */
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    /** Severity of the representative incident. */
    severity: 'critical' | 'warning' | 'info';
    /** created_at of the representative incident. */
    created_at: string;
    /** All active incident ids for (signature, container_name). Length == incident_count. */
    incident_ids: string[];
    /** How many active incidents this container has under this signature. */
    incident_count: number;
    /** updated_at of the most recently updated incident among incident_ids. */
    latest_at: string;
    /** incidents.summary of the representative incident (LLM-derived, may be null). */
    latest_summary: string | null;
    /** insights.description of the representative incident's root-cause insight (contains metric values, may be null). */
    latest_description: string | null;
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

  // 2. One representative row per (signature, container_name), ordered by severity then recency.
  //    `representative` = highest-severity incident on that container; ties broken by most-recent created_at.
  //    `incident_ids` = ALL active incidents on that (signature, container) pair so the UI can render counts
  //    and the resolve action can act on the whole pair.
  //    `latest_description` is sourced from the representative incident's root-cause insight when present.
  const rawTop = await db.query<{
    signature: string;
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
    incident_ids: string[];
    incident_count: number;
    latest_at: string;
    latest_summary: string | null;
    latest_description: string | null;
  }>(`
    WITH base AS (
      SELECT id, signature, severity, endpoint_id, endpoint_name,
             created_at, updated_at, affected_containers,
             root_cause_insight_id, summary
      FROM incidents ${whereSQL}
    ),
    expanded AS (
      SELECT b.id AS incident_id, b.signature, b.severity, b.endpoint_id, b.endpoint_name,
             b.created_at, b.updated_at, b.root_cause_insight_id, b.summary,
             e.container_name
      FROM base b
      CROSS JOIN LATERAL jsonb_array_elements_text(b.affected_containers) AS e(container_name)
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY signature, container_name
               ORDER BY (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                        created_at DESC,
                        incident_id DESC
             ) AS rn_in_container
      FROM expanded
    ),
    representatives AS (
      SELECT signature, container_name,
             incident_id AS rep_incident_id,
             severity AS rep_severity,
             endpoint_id, endpoint_name,
             created_at AS rep_created_at,
             root_cause_insight_id AS rep_root_cause_insight_id,
             summary AS rep_summary
      FROM ranked
      WHERE rn_in_container = 1
    ),
    grouped AS (
      SELECT signature, container_name,
             ARRAY_AGG(incident_id ORDER BY created_at DESC) AS incident_ids,
             COUNT(*)::int AS incident_count,
             MAX(updated_at)::text AS latest_at
      FROM expanded
      GROUP BY signature, container_name
    ),
    joined AS (
      SELECT r.signature, r.container_name,
             r.rep_incident_id AS incident_id,
             r.rep_severity AS severity,
             r.endpoint_id, r.endpoint_name,
             r.rep_created_at::text AS created_at,
             g.incident_ids, g.incident_count, g.latest_at,
             r.rep_summary AS latest_summary,
             ins.description AS latest_description,
             ROW_NUMBER() OVER (
               PARTITION BY r.signature
               ORDER BY (CASE r.rep_severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                        r.rep_created_at DESC,
                        r.rep_incident_id DESC
             ) AS rn
      FROM representatives r
      JOIN grouped g
        ON g.signature = r.signature AND g.container_name = r.container_name
      LEFT JOIN insights ins
        ON ins.id = r.rep_root_cause_insight_id
    )
    SELECT signature, incident_id, container_name, endpoint_id, endpoint_name,
           severity, created_at, incident_ids, incident_count, latest_at,
           latest_summary, latest_description, rn
    FROM joined
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
      incident_id: r.incident_id,
      container_name: r.container_name,
      endpoint_id: r.endpoint_id,
      endpoint_name: r.endpoint_name,
      severity: r.severity,
      created_at: r.created_at,
      incident_ids: r.incident_ids,
      incident_count: r.incident_count,
      latest_at: r.latest_at,
      latest_summary: r.latest_summary,
      latest_description: r.latest_description,
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
