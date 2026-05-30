-- PostgreSQL migration: image_staleness table
-- Converted from SQLite migration 018_image_staleness.sql

CREATE TABLE IF NOT EXISTS image_staleness (
  id SERIAL PRIMARY KEY,
  image_name TEXT NOT NULL,
  image_tag TEXT NOT NULL DEFAULT 'latest',
  registry TEXT NOT NULL DEFAULT 'docker.io',
  local_digest TEXT,
  remote_digest TEXT,
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  days_since_update INTEGER,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(image_name, image_tag, registry)
);

CREATE INDEX IF NOT EXISTS idx_image_staleness_stale ON image_staleness(is_stale);
CREATE INDEX IF NOT EXISTS idx_image_staleness_name ON image_staleness(image_name);
