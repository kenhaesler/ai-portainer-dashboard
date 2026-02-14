-- PostgreSQL migration: investigations table
-- Converted from SQLite migrations 009_investigations.sql + 023_investigation_ai_summary.sql

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL REFERENCES insights(id),
  endpoint_id INTEGER,
  container_id TEXT,
  container_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'gathering', 'analyzing', 'complete', 'failed')),
  evidence_summary TEXT,
  root_cause TEXT,
  contributing_factors TEXT,
  severity_assessment TEXT,
  recommended_actions TEXT,
  confidence_score DOUBLE PRECISION,
  analysis_duration_ms INTEGER,
  llm_model TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  -- Added in 023_investigation_ai_summary.sql
  ai_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_investigations_insight ON investigations(insight_id);
CREATE INDEX IF NOT EXISTS idx_investigations_container ON investigations(container_id);
CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations(created_at);
