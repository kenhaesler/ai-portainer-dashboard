-- Migration 038: add typed `z_score` column to insights (#1308)
--
-- The per-user Sensitivity preset filter (#1297) previously recovered each
-- anomaly's z-score by regex-scraping the free-text `description` column
-- (`extractZScore`). That coupling silently degrades to "pass everything
-- through" if a detector ever changes its wording. This column persists the
-- z-score as structured data so the read-path filter reads a typed value.
--
-- NULL for records that never carried a z-score (isolation-forest, threshold,
-- prediction, error-rate-only trace anomalies) — the filter passes NULL
-- through unchanged, preserving today's behaviour.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + the backfill is guarded by
-- `z_score IS NULL`. Reversible via `ALTER TABLE insights DROP COLUMN z_score`.

ALTER TABLE insights ADD COLUMN IF NOT EXISTS z_score NUMERIC;

-- One-time backfill: re-parse the load-bearing "z-score: X" substring from the
-- existing description so historical rows match the typed read.
-- Subset of the JS extractZScore regex — the scientific-notation arm
-- ((?:[eE][+-]?\d+)?) is intentionally omitted because the detectors format
-- z-scores with .toFixed(2), which never produces scientific notation.
-- Postgres ARE: \s matches [[:space:]].
-- Guarded by z_score IS NULL so re-runs
-- are no-ops; only rows whose description contains a numeric z-score are touched.
UPDATE insights
SET z_score = (substring(description from 'z-score:\s*(-?[0-9]+(?:\.[0-9]+)?)'))::numeric
WHERE z_score IS NULL
  AND description ~ 'z-score:\s*-?[0-9]';
