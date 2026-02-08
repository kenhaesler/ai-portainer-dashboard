CREATE TABLE IF NOT EXISTS ebpf_coverage (
  endpoint_id INTEGER PRIMARY KEY,
  endpoint_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('planned', 'deployed', 'excluded', 'failed', 'unknown')),
  exclusion_reason TEXT,
  deployment_profile TEXT,
  last_trace_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
