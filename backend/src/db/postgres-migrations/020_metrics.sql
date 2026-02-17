-- PostgreSQL migration: metrics table
-- Converted from SQLite migrations 004_metrics.sql + 020_network_metrics.sql
-- Final state with network metric types included

CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  metric_type TEXT NOT NULL
    CHECK (metric_type IN ('cpu', 'memory', 'memory_bytes', 'network_rx_bytes', 'network_tx_bytes')),
  value DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_container_time ON metrics(container_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_type_time ON metrics(metric_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_endpoint ON metrics(endpoint_id);
