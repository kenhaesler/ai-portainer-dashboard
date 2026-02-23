-- PostgreSQL migration: pcap_captures table
-- Converted from SQLite migrations 011, 026, 027
-- Final state with 'succeeded' status and analysis_result column

CREATE TABLE IF NOT EXISTS pcap_captures (
  id TEXT PRIMARY KEY,
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'capturing', 'processing', 'complete', 'failed', 'succeeded')),
  filter TEXT,
  duration_seconds INTEGER,
  max_packets INTEGER,
  capture_file TEXT,
  file_size_bytes INTEGER,
  packet_count INTEGER,
  protocol_stats JSONB,
  exec_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analysis_result JSONB
);

CREATE INDEX IF NOT EXISTS idx_pcap_captures_status ON pcap_captures(status);
CREATE INDEX IF NOT EXISTS idx_pcap_captures_container_id ON pcap_captures(container_id);
CREATE INDEX IF NOT EXISTS idx_pcap_captures_created_at ON pcap_captures(created_at);
