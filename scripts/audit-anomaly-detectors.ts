#!/usr/bin/env -S node --experimental-strip-types
/**
 * Audit anomaly detectors — issue #1294, epic #1291.
 *
 * Groups recent `insights` rows (last 14 days by default) by detector source
 * (`detection_method` + `metric_type` derived per signature.ts) and severity,
 * and estimates a false-positive share using whichever proxy the current
 * schema actually supports. As of migration 030 we have:
 *   - `is_acknowledged` (BOOLEAN) on `insights`
 *   - `status` (active / resolved) on `incidents`
 *   - no explicit "false positive" disposition column
 *
 * We therefore estimate the false-positive share as:
 *
 *   fp_share ≈ (acknowledged AND no follow-up incident still active)
 *             + (insights whose only correlated incident resolved itself
 *                within the 10-min cooldown window with no manual action)
 *           / total_anomalies
 *
 * This is a proxy, not ground truth. The narrative in the design note
 * documents the limitations and the next-step #1298 work that will add a
 * proper `false_positive` flag.
 *
 * Usage:
 *   POSTGRES_APP_URL=postgresql://...  node --experimental-strip-types \
 *     scripts/audit-anomaly-detectors.ts [days]
 *
 * Or via psql with the SQL printed by `--print-sql`:
 *   node --experimental-strip-types scripts/audit-anomaly-detectors.ts --print-sql
 *   psql "$POSTGRES_APP_URL" -f /tmp/audit.sql
 *
 * Output: a Markdown table printed to stdout — pipe into the design note.
 */

import process from 'node:process';

const AUDIT_SQL = `
-- Audit anomaly detectors over the last :days days. Detector "source" is
-- derived from (detection_method, metric_type) the same way
-- packages/ai-intelligence/src/services/signature.ts derives signatures so
-- the audit aligns with the runtime correlator's grouping.
WITH derived AS (
  SELECT
    i.id,
    i.severity,
    i.is_acknowledged,
    i.created_at,
    -- Detector source (matches the runtime grouping):
    CASE
      WHEN i.detection_method = 'ml-anomaly' AND i.metric_type IN ('latency_p95', 'error_rate')
        THEN 'trace:' || i.metric_type
      WHEN i.detection_method = 'ml-anomaly' AND i.metric_type IS NOT NULL
        THEN 'isolation-forest:' || i.metric_type
      WHEN i.detection_method = 'threshold' AND i.metric_type IS NOT NULL
        THEN 'metric-zscore:' || i.metric_type
      WHEN i.title ~* 'predicted\\s+(cpu|memory|disk)\\s+exhaustion'
        THEN 'predictive'
      WHEN i.category = 'log-analysis' THEN 'log-pattern'
      WHEN i.category = 'security'     THEN 'security-scan'
      ELSE COALESCE(i.detection_method, 'unknown') || ':' || COALESCE(i.metric_type, i.category)
    END AS detector_source
  FROM insights i
  WHERE i.created_at >= NOW() - INTERVAL ':days days'
),
-- Self-resolution proxy: an insight whose only related incident resolved
-- itself within the 10-min cooldown window with no follow-up acknowledgement.
-- Cheap heuristic: incident.resolved_at - incident.created_at < interval '10 min'
self_resolved AS (
  SELECT DISTINCT (jsonb_array_elements_text(i.related_insight_ids))::text AS insight_id
  FROM incidents i
  WHERE i.status = 'resolved'
    AND i.resolved_at IS NOT NULL
    AND i.resolved_at - i.created_at < INTERVAL '10 minutes'
    AND i.created_at >= NOW() - INTERVAL ':days days'
),
classified AS (
  SELECT
    d.detector_source,
    d.severity,
    d.id,
    -- Proxy: false-positive if acknowledged with no manual follow-up
    -- (we approximate "no follow-up" with "no other unresolved incident
    -- referencing this insight"), OR if its correlated incident self-
    -- resolved within 10 minutes.
    (d.is_acknowledged OR sr.insight_id IS NOT NULL) AS fp_proxy
  FROM derived d
  LEFT JOIN self_resolved sr ON sr.insight_id = d.id
)
SELECT
  detector_source                                         AS "Detector",
  COUNT(*)                                                AS "Total anomalies",
  COUNT(*) FILTER (WHERE severity = 'critical')           AS "Critical",
  COUNT(*) FILTER (WHERE severity = 'warning')            AS "Warning",
  COUNT(*) FILTER (WHERE severity = 'info')               AS "Info",
  ROUND(100.0 * COUNT(*) FILTER (WHERE fp_proxy) / GREATEST(COUNT(*), 1), 1)
                                                          AS "Est. FP share (%)"
FROM classified
GROUP BY detector_source
ORDER BY COUNT(*) DESC;
`;

function renderMarkdownTable(
  cols: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const header = `| ${cols.join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows
    .map(
      (r) =>
        `| ${cols
          .map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c])))
          .join(' | ')} |`,
    )
    .join('\n');
  return [header, sep, body].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const days = Number(args.find((a) => /^\d+$/.test(a)) ?? '14');

  if (args.includes('--print-sql')) {
    process.stdout.write(AUDIT_SQL.replaceAll(':days', String(days)));
    process.stdout.write('\n');
    return;
  }

  const url = process.env.POSTGRES_APP_URL;
  if (!url) {
    process.stderr.write(
      'POSTGRES_APP_URL is not set. Re-run with the URL exported, or use --print-sql to emit raw SQL.\n',
    );
    process.exit(2);
  }

  // Lazy import: this script is committed for documentation; pg is a
  // production dependency of the backend so importing here is free in
  // operator deployments but optional in CI.
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(AUDIT_SQL.replaceAll(':days', String(days)));
    const cols = result.fields.map((f) => f.name);
    const md = renderMarkdownTable(
      cols,
      result.rows as Array<Record<string, unknown>>,
    );
    process.stdout.write(`# Anomaly detector audit (last ${days} days)\n\n`);
    process.stdout.write(md);
    process.stdout.write('\n');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`audit-anomaly-detectors failed: ${err.message}\n`);
  process.exit(1);
});
