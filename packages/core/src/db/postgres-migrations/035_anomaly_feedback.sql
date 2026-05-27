-- PostgreSQL migration: anomaly_feedback table
-- Issue #1298 — false-positive feedback loop (epic #1291, child E).
--
-- Operators can mark an ML-detected anomaly as a false positive. Each
-- feedback row is scoped to one (anomaly, user) pair so multiple operators
-- can legitimately disagree about the same anomaly: a UNIQUE
-- (anomaly_id, user_id) constraint enforces "one disposition per user per
-- anomaly" with multi-user semantics — two operators marking the same
-- anomaly as false positive yields two rows, not one, so the per-detector
-- rate calculation has the per-user signal it needs.
--
-- Resubmitting the same (anomaly_id, user_id) pair is a no-op via
-- ON CONFLICT (anomaly_id, user_id) DO NOTHING in the route handler; the
-- existing created_at is preserved.
--
-- `disposition` is initially limited to 'false-positive' but reserves
-- 'true-positive' and 'unsure' for future expansion (see issue #1298).
--
-- `anomaly_id` is stored as TEXT (no FK constraint). Anomaly records have
-- two production sources: rows in `insights` (stored), and
-- `CorrelatedAnomaly` results from `detectCorrelatedAnomalies` in
-- @dashboard/observability (computed on the fly from TimescaleDB metric
-- snapshots and never persisted). A foreign key would force feedback to
-- live only on the persisted-insight branch, which excludes the
-- ML-Detected Anomalies cards. The route handler validates length/format
-- via Zod instead.
--
-- `user_id` references users(id) with ON DELETE CASCADE so a deleted
-- user's feedback is removed with them. (Keeping this FK is safe — users
-- table is the canonical authority and is queried on every request.)

CREATE TABLE IF NOT EXISTS anomaly_feedback (
  id SERIAL PRIMARY KEY,
  anomaly_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL DEFAULT 'false-positive'
    CHECK (disposition IN ('false-positive', 'true-positive', 'unsure')),
  /**
   * `detector` is denormalised onto the feedback row so the rate
   * calculation works for correlated anomalies (which have no row in
   * the `insights` table and therefore no `detection_method` to JOIN
   * against). For insight-backed feedback the route still computes
   * rates by JOINing on insights.detection_method; for
   * correlated-anomaly feedback the rate is computed from this column.
   * NULL means "unknown / no detector tag" — handled the same as
   * insights.detection_method IS NULL.
   */
  detector TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT anomaly_feedback_one_per_user_per_anomaly
    UNIQUE (anomaly_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_anomaly_feedback_anomaly ON anomaly_feedback(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_feedback_user ON anomaly_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_feedback_detector ON anomaly_feedback(detector);
