-- Migration 036: per-user settings (key-value)
-- Renumbered from 035 per epic #1291 merge order (#1306 keeps 035, this PR
-- takes 036, #1305 takes 037).
--
-- Rationale: issue #1297 needs a place to store a per-user anomaly
-- "Sensitivity" preset (Low / Default / High). No existing user_settings
-- table exists today and adding a column on `users` would block follow-up
-- per-user preferences (Notifications mute, default time-range, etc.) that
-- the epic spawned by #1291 anticipates. A small key/value table keeps the
-- door open without locking schema changes behind per-feature migrations.
--
-- Shape: one row per (user_id, key); a TEXT `value` column holds the
-- preset name today and JSON-encoded values later if needed. The
-- application-side store validates `value` via Zod before inserting.
--
-- Rollback: DROP TABLE IF EXISTS user_settings;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
