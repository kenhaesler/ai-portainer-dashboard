-- PostgreSQL migration: monitoring_cycles + monitoring_snapshots tables
-- Converted from SQLite migration 012_monitoring_telemetry.sql

CREATE TABLE IF NOT EXISTS monitoring_cycles (
  id SERIAL PRIMARY KEY,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_cycles_created_at ON monitoring_cycles(created_at);

CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id SERIAL PRIMARY KEY,
  containers_running INTEGER NOT NULL,
  containers_stopped INTEGER NOT NULL,
  containers_unhealthy INTEGER NOT NULL,
  endpoints_up INTEGER NOT NULL,
  endpoints_down INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_created_at ON monitoring_snapshots(created_at);
