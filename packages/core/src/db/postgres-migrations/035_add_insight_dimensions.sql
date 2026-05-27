-- Migration 035: add `dimensions` JSONB column to insights
--
-- Supports correlated anomaly suppression (#1296). When the trace detector
-- would fire two anomalies for the same `(service, minute)` pair across
-- different dimensions (e.g. p95 latency + error rate), the writer now
-- persists ONE insight whose `dimensions` array carries both signals
-- instead of two separate records.
--
-- Each element in the array has the shape:
--   { "type": "latency_p95" | "error_rate", "value": number,
--     "baseline": number, "zScore": number, "severity": "warning" | "critical" }
--
-- Backwards-compatible: NULL for legacy single-dimension records, which
-- continue to flow through the existing `metric_type` column.
--
-- Idempotent (`IF NOT EXISTS`) so re-runs are safe; reversible by
-- `ALTER TABLE insights DROP COLUMN dimensions` if a rollback is needed.

ALTER TABLE insights ADD COLUMN IF NOT EXISTS dimensions JSONB;
