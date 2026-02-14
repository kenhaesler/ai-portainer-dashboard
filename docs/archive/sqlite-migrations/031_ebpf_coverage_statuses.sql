-- Add new coverage statuses: not_deployed, unreachable, incompatible
-- SQLite cannot ALTER CHECK constraints, so we recreate the table
CREATE TABLE IF NOT EXISTS ebpf_coverage_new (
  endpoint_id   INTEGER PRIMARY KEY,
  endpoint_name TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('planned','deployed','excluded','failed','unknown','not_deployed','unreachable','incompatible')),
  exclusion_reason    TEXT,
  deployment_profile  TEXT,
  last_trace_at       TEXT,
  last_verified_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO ebpf_coverage_new SELECT * FROM ebpf_coverage;
DROP TABLE IF EXISTS ebpf_coverage;
ALTER TABLE ebpf_coverage_new RENAME TO ebpf_coverage;
