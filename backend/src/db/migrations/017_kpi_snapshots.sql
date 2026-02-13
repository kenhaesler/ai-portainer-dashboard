-- KPI snapshot history for dashboard sparklines
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoints INTEGER NOT NULL DEFAULT 0,
  endpoints_up INTEGER NOT NULL DEFAULT 0,
  endpoints_down INTEGER NOT NULL DEFAULT 0,
  running INTEGER NOT NULL DEFAULT 0,
  stopped INTEGER NOT NULL DEFAULT 0,
  healthy INTEGER NOT NULL DEFAULT 0,
  unhealthy INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  stacks INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_timestamp ON kpi_snapshots(timestamp);
