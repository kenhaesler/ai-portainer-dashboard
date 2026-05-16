-- Analysis queries for the incident-engine dedup follow-up (issue #1200).
--
-- Run against the prod / staging Postgres after #1199 has been deployed for
-- at least one week. The four queries map to the four data-driven questions
-- in the issue body; run them in order and capture the results in
--   docs/superpowers/specs/2026-05-16-1200-dedup-telemetry-design.md
-- under the "Findings" section.
--
-- The `insights` table does not have a `signature` column today (signatures
-- live on `incidents`); these queries derive the signature inline from
-- (category, detection_method, metric_type) the same way
-- packages/ai-intelligence/src/services/signature.ts does.
--
-- Usage:
--   psql "$POSTGRES_URL" -f scripts/analyze-dedup-engine.sql
--   # or, in docker-compose:
--   docker exec -i <postgres-container> psql -U app_user -d portainer_dashboard \
--     -f scripts/analyze-dedup-engine.sql

\echo
\echo === Q1: alerts_per_container ratio per derived signature (top 20) ===
\echo
WITH derived AS (
  SELECT
    -- Mirrors services/signature.ts deriveSignature + TITLE_RULES so this script
    -- reports the same signatures the runtime correlator does. Order matters:
    -- the ml-detected branch must come before the bare anomalous-usage rule.
    CASE
      WHEN metric_type IS NOT NULL AND detection_method IS NOT NULL
        THEN category || ':' || detection_method || ':' || metric_type
      WHEN category = 'security'     THEN 'security:scan'
      WHEN category = 'log-analysis' THEN 'log:pattern'
      WHEN category = 'ai-analysis'  THEN 'ai:analysis'
      WHEN title ~* 'predicted\s+(cpu|memory|disk)\s+exhaustion'
        THEN 'predictive:prediction:' || lower((regexp_match(title, 'predicted\s+(cpu|memory|disk)\s+exhaustion', 'i'))[1])
      WHEN title ~* 'anomalous\s+(cpu|memory|disk)\s+usage[^()]*\(ml-detected\)'
        THEN 'anomaly:ml-anomaly:' || lower((regexp_match(title, 'anomalous\s+(cpu|memory|disk)', 'i'))[1])
      WHEN title ~* 'anomalous\s+(cpu|memory|disk)\s+usage'
        THEN 'anomaly:threshold:' || lower((regexp_match(title, 'anomalous\s+(cpu|memory|disk)', 'i'))[1])
      WHEN title ~* 'high\s+(cpu|memory|disk)\s+usage'
        THEN 'anomaly:threshold:' || lower((regexp_match(title, 'high\s+(cpu|memory|disk)', 'i'))[1])
      WHEN title ~* 'no health check (configured|defined)|missing health check'
        THEN 'config:health-check:missing'
      WHEN title ~* 'host network mode'
        THEN 'config:network:host-mode'
      ELSE category || ':unknown'
    END AS signature,
    container_name
  FROM insights
  WHERE created_at >= NOW() - INTERVAL '7 days'
)
SELECT
  signature,
  COUNT(*)                                                                       AS total_insights,
  COUNT(DISTINCT container_name)                                                 AS distinct_containers,
  ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT container_name), 0), 2)        AS alerts_per_container
FROM derived
GROUP BY signature
ORDER BY alerts_per_container DESC
LIMIT 20;

\echo
\echo === Q2: insights_per_incident per signature ===
\echo
SELECT
  signature,
  COUNT(*)                                                                       AS total_incidents,
  ROUND(AVG(insight_count)::numeric, 2)                                          AS avg_insights_per_incident,
  ROUND(AVG(jsonb_array_length(affected_containers))::numeric, 2)                AS avg_containers_per_incident
FROM incidents
WHERE status = 'active' OR resolved_at >= NOW() - INTERVAL '7 days'
GROUP BY signature
ORDER BY total_incidents DESC;

\echo
\echo === Q3: emission share by category ===
\echo
SELECT
  category,
  COUNT(*)                                                                       AS total,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)                             AS pct
FROM insights
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY category
ORDER BY total DESC;

\echo
\echo === Q4: dedup headroom for non-anomaly categories ===
\echo (How many insights would collapse if (signature, container_name) keying applied.)
\echo
WITH derived AS (
  SELECT
    -- Same signature derivation as Q1 above. Keep in sync with both.
    CASE
      WHEN metric_type IS NOT NULL AND detection_method IS NOT NULL
        THEN category || ':' || detection_method || ':' || metric_type
      WHEN category = 'security'     THEN 'security:scan'
      WHEN category = 'log-analysis' THEN 'log:pattern'
      WHEN category = 'ai-analysis'  THEN 'ai:analysis'
      WHEN title ~* 'predicted\s+(cpu|memory|disk)\s+exhaustion'
        THEN 'predictive:prediction:' || lower((regexp_match(title, 'predicted\s+(cpu|memory|disk)\s+exhaustion', 'i'))[1])
      WHEN title ~* 'anomalous\s+(cpu|memory|disk)\s+usage[^()]*\(ml-detected\)'
        THEN 'anomaly:ml-anomaly:' || lower((regexp_match(title, 'anomalous\s+(cpu|memory|disk)', 'i'))[1])
      WHEN title ~* 'anomalous\s+(cpu|memory|disk)\s+usage'
        THEN 'anomaly:threshold:' || lower((regexp_match(title, 'anomalous\s+(cpu|memory|disk)', 'i'))[1])
      WHEN title ~* 'high\s+(cpu|memory|disk)\s+usage'
        THEN 'anomaly:threshold:' || lower((regexp_match(title, 'high\s+(cpu|memory|disk)', 'i'))[1])
      WHEN title ~* 'no health check (configured|defined)|missing health check'
        THEN 'config:health-check:missing'
      WHEN title ~* 'host network mode'
        THEN 'config:network:host-mode'
      ELSE category || ':unknown'
    END AS signature,
    category,
    container_name
  FROM insights
  WHERE created_at >= NOW() - INTERVAL '7 days'
)
SELECT
  category,
  COUNT(*)                                                                       AS insights,
  COUNT(*) FILTER (WHERE rn > 1)                                                  AS would_be_deduped,
  ROUND(100.0 * COUNT(*) FILTER (WHERE rn > 1) / NULLIF(COUNT(*), 0), 1)         AS pct_deduped
FROM (
  SELECT signature, category, container_name,
         row_number() OVER (PARTITION BY signature, container_name ORDER BY container_name) AS rn
  FROM derived
) d
WHERE category != 'anomaly'
GROUP BY category
ORDER BY insights DESC;
