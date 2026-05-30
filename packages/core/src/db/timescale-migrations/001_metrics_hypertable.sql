-- Metrics hypertable (7-day chunks)
CREATE TABLE IF NOT EXISTS metrics (
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT create_hypertable('metrics', 'timestamp', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- Indexes matching current query patterns
CREATE INDEX IF NOT EXISTS idx_metrics_container_time ON metrics(container_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_endpoint ON metrics(endpoint_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_composite ON metrics(container_id, metric_type, timestamp DESC);

-- 5-minute continuous aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_5min WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', timestamp) AS bucket,
  endpoint_id, container_id, container_name, metric_type,
  AVG(value) AS avg_value, MIN(value) AS min_value, MAX(value) AS max_value,
  STDDEV(value) AS stddev_value, COUNT(*) AS sample_count
FROM metrics GROUP BY bucket, endpoint_id, container_id, container_name, metric_type;

-- 1-hour continuous aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1hour WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', timestamp) AS bucket,
  endpoint_id, container_id, container_name, metric_type,
  AVG(value) AS avg_value, MIN(value) AS min_value, MAX(value) AS max_value,
  STDDEV(value) AS stddev_value, COUNT(*) AS sample_count
FROM metrics GROUP BY bucket, endpoint_id, container_id, container_name, metric_type;

-- 1-day continuous aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1day WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', timestamp) AS bucket,
  endpoint_id, container_id, container_name, metric_type,
  AVG(value) AS avg_value, MIN(value) AS min_value, MAX(value) AS max_value,
  STDDEV(value) AS stddev_value, COUNT(*) AS sample_count
FROM metrics GROUP BY bucket, endpoint_id, container_id, container_name, metric_type;

-- Refresh policies for continuous aggregates
SELECT add_continuous_aggregate_policy('metrics_5min',
  start_offset => INTERVAL '15 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('metrics_1hour',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('metrics_1day',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);

-- KPI snapshots hypertable
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  endpoints INTEGER NOT NULL DEFAULT 0,
  endpoints_up INTEGER NOT NULL DEFAULT 0,
  endpoints_down INTEGER NOT NULL DEFAULT 0,
  running INTEGER NOT NULL DEFAULT 0,
  stopped INTEGER NOT NULL DEFAULT 0,
  healthy INTEGER NOT NULL DEFAULT 0,
  unhealthy INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  stacks INTEGER NOT NULL DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT create_hypertable('kpi_snapshots', 'timestamp', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_timestamp ON kpi_snapshots(timestamp DESC);

-- Enable compression on raw metrics (compress chunks older than 7 days)
ALTER TABLE metrics SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'container_id, metric_type',
  timescaledb.compress_orderby = 'timestamp DESC'
);
SELECT add_compression_policy('metrics', compress_after => INTERVAL '7 days', if_not_exists => TRUE);
