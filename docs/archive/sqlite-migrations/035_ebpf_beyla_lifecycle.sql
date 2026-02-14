ALTER TABLE ebpf_coverage ADD COLUMN beyla_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ebpf_coverage ADD COLUMN beyla_container_id TEXT;
ALTER TABLE ebpf_coverage ADD COLUMN beyla_managed INTEGER NOT NULL DEFAULT 0;
