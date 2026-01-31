CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('cpu', 'memory', 'memory_bytes')),
  value REAL NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_metrics_container_time ON metrics(container_id, timestamp);
CREATE INDEX idx_metrics_type_time ON metrics(metric_type, timestamp);
CREATE INDEX idx_metrics_endpoint ON metrics(endpoint_id);
