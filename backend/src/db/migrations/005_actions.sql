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
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  executed_at TEXT,
  completed_at TEXT,
  execution_result TEXT,
  execution_duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_container ON actions(container_id);
CREATE INDEX idx_actions_created ON actions(created_at);
