CREATE TABLE IF NOT EXISTS monitoring_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_monitoring_cycles_created_at ON monitoring_cycles(created_at);

CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  containers_running INTEGER NOT NULL,
  containers_stopped INTEGER NOT NULL,
  containers_unhealthy INTEGER NOT NULL,
  endpoints_up INTEGER NOT NULL,
  endpoints_down INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_monitoring_snapshots_created_at ON monitoring_snapshots(created_at);
