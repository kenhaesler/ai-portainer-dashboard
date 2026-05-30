-- PostgreSQL migration: prompt version history table
-- Stores a full-text snapshot of each prompt save, enabling history and rollback.
-- Related to: feature/415-prompt-version-history

CREATE TABLE IF NOT EXISTS prompt_versions (
  id            SERIAL PRIMARY KEY,
  feature       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  model         TEXT,
  temperature   NUMERIC,
  changed_by    TEXT NOT NULL DEFAULT 'system',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_note   TEXT
);

-- Enforce unique (feature, version) pairs
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_feature_version
  ON prompt_versions(feature, version);

-- Speed up history queries (most recent first per feature)
CREATE INDEX IF NOT EXISTS idx_prompt_versions_feature_changed_at
  ON prompt_versions(feature, changed_at DESC);
