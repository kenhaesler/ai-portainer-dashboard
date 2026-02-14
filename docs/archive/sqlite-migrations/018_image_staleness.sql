CREATE TABLE IF NOT EXISTS image_staleness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_name TEXT NOT NULL,
  image_tag TEXT NOT NULL DEFAULT 'latest',
  registry TEXT NOT NULL DEFAULT 'docker.io',
  local_digest TEXT,
  remote_digest TEXT,
  is_stale INTEGER NOT NULL DEFAULT 0,
  days_since_update INTEGER,
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(image_name, image_tag, registry)
);

CREATE INDEX IF NOT EXISTS idx_image_staleness_stale ON image_staleness(is_stale);
CREATE INDEX IF NOT EXISTS idx_image_staleness_name ON image_staleness(image_name);
