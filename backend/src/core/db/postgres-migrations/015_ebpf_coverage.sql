-- PostgreSQL migration: ebpf_coverage table
-- Converted from SQLite migrations 028, 031, 035, 037
-- Final state with extended statuses and Beyla lifecycle columns

CREATE TABLE IF NOT EXISTS ebpf_coverage (
  endpoint_id INTEGER PRIMARY KEY,
  endpoint_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('planned', 'deployed', 'excluded', 'failed', 'unknown',
                      'not_deployed', 'unreachable', 'incompatible')),
  exclusion_reason TEXT,
  deployment_profile TEXT,
  last_trace_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Added in 035_ebpf_beyla_lifecycle.sql
  beyla_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  beyla_container_id TEXT,
  beyla_managed BOOLEAN NOT NULL DEFAULT FALSE,
  -- Added in 037_ebpf_otlp_endpoint_override.sql
  otlp_endpoint_override TEXT
);
