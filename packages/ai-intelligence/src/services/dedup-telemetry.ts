/**
 * Dedup-engine telemetry collector (issue #1200).
 *
 * Runs hourly. Computes per-signature emission ratios over the last 7 days
 * and writes one row per signature to `monitoring_dedup_metrics`. The
 * follow-up engine PR uses the resulting time series to baseline before/after
 * tightening cooldowns or admitting non-anomaly categories into correlation.
 *
 * SQL derives the signature inline from (category, detection_method,
 * metric_type) the same way services/signature.ts does for runtime emission.
 * Keeping the rule in SQL means the rollup follows new structured fields as
 * they're added without a code deploy.
 */
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';

const log = createChildLogger('dedup-telemetry');

export interface DedupMetricRow {
  signature: string;
  total_insights: number;
  distinct_containers: number;
  alerts_per_container: number;
  total_incidents: number;
  avg_insights_per_incident: number;
}

interface InsightAggRow {
  signature: string;
  total_insights: number | string;
  distinct_containers: number | string;
  alerts_per_container: number | string;
}

interface IncidentAggRow {
  signature: string;
  total_incidents: number | string;
  avg_insights_per_incident: number | string;
}

const WINDOW_HOURS_DEFAULT = 24 * 7;

// CASE expression mirrors services/signature.ts deriveSignature + TITLE_RULES.
// Order matters — ml-anomaly must come before the bare "anomalous … usage"
// rule, otherwise the threshold variant would win for ML-tagged titles.
// Keep this in lock-step with signature.ts; the unit test
// `signature-sql-parity` in dedup-telemetry.test.ts pins the parity.
const INSIGHTS_AGG_SQL = `
  WITH derived AS (
    SELECT
      CASE
        WHEN metric_type IS NOT NULL AND detection_method IS NOT NULL
          THEN category || ':' || detection_method || ':' || metric_type
        WHEN category = 'security'     THEN 'security:scan'
        WHEN category = 'log-analysis' THEN 'log:pattern'
        WHEN category = 'ai-analysis'  THEN 'ai:analysis'
        WHEN title ~* 'predicted\\s+(cpu|memory|disk)\\s+exhaustion'
          THEN 'predictive:prediction:' || lower((regexp_match(title, 'predicted\\s+(cpu|memory|disk)\\s+exhaustion', 'i'))[1])
        WHEN title ~* 'anomalous\\s+(cpu|memory|disk)\\s+usage[^()]*\\(ml-detected\\)'
          THEN 'anomaly:ml-anomaly:' || lower((regexp_match(title, 'anomalous\\s+(cpu|memory|disk)', 'i'))[1])
        WHEN title ~* 'anomalous\\s+(cpu|memory|disk)\\s+usage'
          THEN 'anomaly:threshold:' || lower((regexp_match(title, 'anomalous\\s+(cpu|memory|disk)', 'i'))[1])
        WHEN title ~* 'high\\s+(cpu|memory|disk)\\s+usage'
          THEN 'anomaly:threshold:' || lower((regexp_match(title, 'high\\s+(cpu|memory|disk)', 'i'))[1])
        WHEN title ~* 'no health check (configured|defined)|missing health check'
          THEN 'config:health-check:missing'
        WHEN title ~* 'host network mode'
          THEN 'config:network:host-mode'
        ELSE category || ':unknown'
      END AS signature,
      container_name
    FROM insights
    WHERE created_at >= NOW() - make_interval(hours => ?)
  )
  SELECT
    signature,
    COUNT(*)::int                                                                  AS total_insights,
    COUNT(DISTINCT container_name)::int                                            AS distinct_containers,
    ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT container_name), 0), 2)::float AS alerts_per_container
  FROM derived
  GROUP BY signature
`;

const INCIDENTS_AGG_SQL = `
  SELECT
    signature,
    COUNT(*)::int                                AS total_incidents,
    ROUND(AVG(insight_count)::numeric, 2)::float AS avg_insights_per_incident
  FROM incidents
  WHERE signature IS NOT NULL
    AND (status = 'active' OR resolved_at >= NOW() - make_interval(hours => ?))
  GROUP BY signature
`;

// ON CONFLICT DO NOTHING pairs with the UNIQUE(signature, collected_at)
// constraint added in migration 033. Two scheduler firings in the same
// millisecond would otherwise produce duplicate rows that subtly inflate
// week-over-week aggregations.
const INSERT_SQL = `
  INSERT INTO monitoring_dedup_metrics (
    collected_at, window_hours, signature,
    total_insights, distinct_containers, alerts_per_container,
    total_incidents, avg_insights_per_incident
  ) VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (signature, collected_at) DO NOTHING
`;

/**
 * Compute the per-signature dedup metrics over the given window.
 *
 * Pure function over the supplied AppDb — no scheduler / wiring coupling — so
 * tests can hand it a real test DB. Returns one row per derived signature
 * with at least one insight in the window. Signatures present in incidents
 * but not in insights are still returned (with total_insights=0,
 * alerts_per_container=0) so operators see the full set.
 */
export async function collectDedupMetrics(
  db: AppDb,
  windowHours: number = WINDOW_HOURS_DEFAULT,
): Promise<DedupMetricRow[]> {
  const [insightRows, incidentRows] = await Promise.all([
    db.query<InsightAggRow>(INSIGHTS_AGG_SQL, [windowHours]),
    db.query<IncidentAggRow>(INCIDENTS_AGG_SQL, [windowHours]),
  ]);

  const incidentBySignature = new Map<string, IncidentAggRow>();
  for (const row of incidentRows) incidentBySignature.set(row.signature, row);

  const rows: DedupMetricRow[] = insightRows.map((r) => {
    const incidentRow = incidentBySignature.get(r.signature);
    incidentBySignature.delete(r.signature);
    return {
      signature: r.signature,
      total_insights: Number(r.total_insights),
      distinct_containers: Number(r.distinct_containers),
      alerts_per_container: Number(r.alerts_per_container ?? 0),
      total_incidents: Number(incidentRow?.total_incidents ?? 0),
      avg_insights_per_incident: Number(incidentRow?.avg_insights_per_incident ?? 0),
    };
  });

  // Signatures with incidents but no insights in window — still useful to record.
  for (const r of incidentBySignature.values()) {
    rows.push({
      signature: r.signature,
      total_insights: 0,
      distinct_containers: 0,
      alerts_per_container: 0,
      total_incidents: Number(r.total_incidents),
      avg_insights_per_incident: Number(r.avg_insights_per_incident ?? 0),
    });
  }

  return rows;
}

export async function insertDedupMetrics(
  db: AppDb,
  windowHours: number,
  rows: DedupMetricRow[],
): Promise<void> {
  for (const row of rows) {
    await db.execute(INSERT_SQL, [
      windowHours,
      row.signature,
      row.total_insights,
      row.distinct_containers,
      row.alerts_per_container,
      row.total_incidents,
      row.avg_insights_per_incident,
    ]);
  }
}

/**
 * Daily retention sweep for `monitoring_dedup_metrics`. The hourly job writes
 * one row per signature per snapshot, so the table grows linearly forever
 * unless something prunes it. 90 days of history is enough to compare the
 * dedup engine's behaviour week-over-week through a release cycle; older
 * data is rarely consulted and can be reconstructed from the raw insights
 * if needed. Returns the number of rows deleted so the scheduler can log.
 */
export async function cleanupOldDedupMetrics(days: number = 90): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const db = getDbForDomain('monitoring');
  const result = await db.execute(
    `DELETE FROM monitoring_dedup_metrics
     WHERE collected_at < NOW() - make_interval(days => ?)`,
    [days],
  );
  return result.changes;
}

export interface DedupTelemetryCycleResult {
  collected: number;
  inserted: number;
  windowHours: number;
}

/**
 * One pass of the hourly telemetry job: collect → insert → return summary
 * for logging. Safe to call when no insights exist (returns 0/0/window).
 */
export async function runDedupTelemetryCycle(
  windowHours: number = WINDOW_HOURS_DEFAULT,
): Promise<DedupTelemetryCycleResult> {
  const db = getDbForDomain('monitoring');
  const rows = await collectDedupMetrics(db, windowHours);
  await insertDedupMetrics(db, windowHours, rows);
  if (rows.length > 0) {
    log.info(
      { signatures: rows.length, windowHours },
      'dedup telemetry snapshot written',
    );
  }
  return { collected: rows.length, inserted: rows.length, windowHours };
}
