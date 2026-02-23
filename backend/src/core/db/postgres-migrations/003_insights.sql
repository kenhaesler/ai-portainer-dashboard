-- PostgreSQL migration: insights table
-- Converted from SQLite migration 003_insights.sql

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  endpoint_id INTEGER,
  endpoint_name TEXT,
  container_id TEXT,
  container_name TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggested_action TEXT,
  is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insights_severity ON insights(severity);
CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at);
CREATE INDEX IF NOT EXISTS idx_insights_container ON insights(container_id);
