CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_settings_category ON settings(category);
