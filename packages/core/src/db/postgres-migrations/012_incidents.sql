-- PostgreSQL migration: incidents table
-- Converted from SQLite migration 014_incidents.sql

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  root_cause_insight_id TEXT REFERENCES insights(id),
  related_insight_ids JSONB NOT NULL DEFAULT '[]',
  affected_containers JSONB NOT NULL DEFAULT '[]',
  endpoint_id INTEGER,
  endpoint_name TEXT,
  correlation_type TEXT NOT NULL,
  correlation_confidence TEXT NOT NULL DEFAULT 'medium'
    CHECK (correlation_confidence IN ('high', 'medium', 'low')),
  insight_count INTEGER NOT NULL DEFAULT 1,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_endpoint_id ON incidents(endpoint_id);
