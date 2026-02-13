-- Add network_rx_bytes and network_tx_bytes to the metrics CHECK constraint.
-- SQLite cannot ALTER CHECK constraints, so we recreate the table preserving data.
CREATE TABLE IF NOT EXISTS metrics_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('cpu', 'memory', 'memory_bytes', 'network_rx_bytes', 'network_tx_bytes')),
  value REAL NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO metrics_new SELECT * FROM metrics;
DROP TABLE metrics;
ALTER TABLE metrics_new RENAME TO metrics;
CREATE INDEX IF NOT EXISTS idx_metrics_container_time ON metrics(container_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_type_time ON metrics(metric_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_endpoint ON metrics(endpoint_id);
