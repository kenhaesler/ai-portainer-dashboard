-- PostgreSQL migration: actions table
-- Converted from SQLite migrations 005_actions.sql + 025_actions_pending_unique.sql

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  insight_id TEXT REFERENCES insights(id),
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'executing', 'completed', 'failed')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  execution_result TEXT,
  execution_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_container ON actions(container_id);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at);

-- Partial unique index to prevent duplicate pending actions per container+type
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_pending_dedup
  ON actions(container_id, action_type)
  WHERE status = 'pending';
