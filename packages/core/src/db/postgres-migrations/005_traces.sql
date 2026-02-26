-- PostgreSQL migration: spans table (traces)
-- Converted from SQLite migrations 006, 022, 036, 037, 038
-- Final state includes all extended Beyla/OTLP attributes

CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('client', 'server', 'internal')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'unset')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms INTEGER,
  service_name TEXT NOT NULL,
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Added in 022_trace_source.sql
  trace_source TEXT DEFAULT 'http',
  -- Added in 036_trace_typed_otlp_attributes.sql
  http_method TEXT,
  http_route TEXT,
  http_status_code INTEGER,
  service_namespace TEXT,
  service_instance_id TEXT,
  service_version TEXT,
  deployment_environment TEXT,
  container_id TEXT,
  container_name TEXT,
  k8s_namespace TEXT,
  k8s_pod_name TEXT,
  k8s_container_name TEXT,
  server_address TEXT,
  server_port INTEGER,
  client_address TEXT,
  -- Added in 038_trace_extended_beyla_attributes.sql
  url_full TEXT,
  url_scheme TEXT,
  network_transport TEXT,
  network_protocol_name TEXT,
  network_protocol_version TEXT,
  net_peer_name TEXT,
  net_peer_port INTEGER,
  host_name TEXT,
  os_type TEXT,
  process_pid INTEGER,
  process_executable_name TEXT,
  process_command TEXT,
  telemetry_sdk_name TEXT,
  telemetry_sdk_language TEXT,
  telemetry_sdk_version TEXT,
  otel_scope_name TEXT,
  otel_scope_version TEXT
);

-- Original indexes
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
CREATE INDEX IF NOT EXISTS idx_spans_time ON spans(start_time);
CREATE INDEX IF NOT EXISTS idx_spans_source ON spans(trace_source);

-- Typed attribute indexes (036)
CREATE INDEX IF NOT EXISTS idx_spans_source_time ON spans(trace_source, start_time);
CREATE INDEX IF NOT EXISTS idx_spans_http_method ON spans(http_method);
CREATE INDEX IF NOT EXISTS idx_spans_http_status_code ON spans(http_status_code);
CREATE INDEX IF NOT EXISTS idx_spans_service_namespace ON spans(service_namespace);
CREATE INDEX IF NOT EXISTS idx_spans_container_name ON spans(container_name);
CREATE INDEX IF NOT EXISTS idx_spans_k8s_namespace ON spans(k8s_namespace);

-- Extended attribute indexes (038)
CREATE INDEX IF NOT EXISTS idx_spans_url_full ON spans(url_full);
CREATE INDEX IF NOT EXISTS idx_spans_host_name ON spans(host_name);
CREATE INDEX IF NOT EXISTS idx_spans_net_peer_name ON spans(net_peer_name);
CREATE INDEX IF NOT EXISTS idx_spans_network_transport ON spans(network_transport);
CREATE INDEX IF NOT EXISTS idx_spans_process_executable_name ON spans(process_executable_name);

-- GIN index on JSONB attributes for flexible querying
CREATE INDEX IF NOT EXISTS idx_spans_attributes_gin ON spans USING GIN (attributes);
