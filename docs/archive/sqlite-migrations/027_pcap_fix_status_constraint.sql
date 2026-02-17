-- Fix CHECK constraint: code uses 'succeeded' but original migration had 'stopped'
-- SQLite cannot ALTER CHECK constraints, so recreate the table.

CREATE TABLE pcap_captures_new (
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
  protocol_stats TEXT,
  exec_id TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  analysis_result TEXT
);

INSERT INTO pcap_captures_new
  SELECT id, endpoint_id, container_id, container_name,
         CASE WHEN status = 'stopped' THEN 'succeeded' ELSE status END,
         filter, duration_seconds, max_packets, capture_file,
         file_size_bytes, packet_count, protocol_stats, exec_id,
         error_message, started_at, completed_at, created_at, analysis_result
  FROM pcap_captures;

DROP TABLE pcap_captures;
ALTER TABLE pcap_captures_new RENAME TO pcap_captures;

CREATE INDEX idx_pcap_captures_status ON pcap_captures(status);
CREATE INDEX idx_pcap_captures_container_id ON pcap_captures(container_id);
CREATE INDEX idx_pcap_captures_created_at ON pcap_captures(created_at);
