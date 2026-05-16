-- Migration 033: monitoring_dedup_metrics — per-signature emission ratios
--
-- Feeds the incident-engine dedup follow-up (issue #1200). The hourly
-- telemetry job in @dashboard/ai/services/dedup-telemetry.ts writes one
-- row per (signature, collected_at) capturing the four ratios from
-- scripts/analyze-dedup-engine.sql so operators can baseline emission
-- pressure week-over-week.
--
-- One snapshot per hour × ~10 distinct signatures ≈ 240 rows/day.
-- An optional cleanup job in the same scheduler drops rows older than
-- 90 days; not enforced via FK or trigger so retention can be tuned in
-- one place.

CREATE TABLE IF NOT EXISTS monitoring_dedup_metrics (
  id                     SERIAL PRIMARY KEY,
  collected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_hours           INTEGER     NOT NULL,
  signature              TEXT        NOT NULL,
  total_insights         INTEGER     NOT NULL,
  distinct_containers    INTEGER     NOT NULL,
  alerts_per_container   NUMERIC(10, 2) NOT NULL,
  total_incidents        INTEGER     NOT NULL DEFAULT 0,
  avg_insights_per_incident NUMERIC(10, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_monitoring_dedup_metrics_collected
  ON monitoring_dedup_metrics(collected_at);
CREATE INDEX IF NOT EXISTS idx_monitoring_dedup_metrics_signature
  ON monitoring_dedup_metrics(signature);
