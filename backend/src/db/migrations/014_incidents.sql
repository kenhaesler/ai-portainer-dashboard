-- Incidents table for grouping correlated alerts
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('critical', 'warning', 'info')) NOT NULL,
  status TEXT CHECK (status IN ('active', 'resolved')) NOT NULL DEFAULT 'active',
  root_cause_insight_id TEXT REFERENCES insights(id),
  related_insight_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of insight IDs
  affected_containers TEXT NOT NULL DEFAULT '[]',   -- JSON array of container names
  endpoint_id INTEGER,
  endpoint_name TEXT,
  correlation_type TEXT NOT NULL,  -- 'temporal', 'topology', 'cascade', 'dedup'
  correlation_confidence TEXT CHECK (correlation_confidence IN ('high', 'medium', 'low')) NOT NULL DEFAULT 'medium',
  insight_count INTEGER NOT NULL DEFAULT 1,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_endpoint_id ON incidents(endpoint_id);
