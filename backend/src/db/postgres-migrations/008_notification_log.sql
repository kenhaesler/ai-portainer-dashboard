-- PostgreSQL migration: notification_log table
-- Converted from SQLite migration 010_notification_log.sql

CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  container_id TEXT,
  container_name TEXT,
  endpoint_id INTEGER,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_created ON notification_log(created_at);
CREATE INDEX IF NOT EXISTS idx_notif_log_channel ON notification_log(channel);
