-- PostgreSQL migration: add sidecar_id column for sidecar-based packet capture
ALTER TABLE pcap_captures ADD COLUMN IF NOT EXISTS sidecar_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pcap_captures_sidecar_id ON pcap_captures(sidecar_id);
