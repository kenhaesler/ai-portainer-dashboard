-- PostgreSQL migration: Harbor vulnerability management tables
-- Phase 1: vulnerability storage, exceptions, and sync tracking

-- Synced vulnerability records from Harbor Security Hub
CREATE TABLE IF NOT EXISTS harbor_vulnerabilities (
  id SERIAL PRIMARY KEY,
  cve_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low', 'None', 'Unknown')),
  cvss_v3_score REAL,
  package TEXT NOT NULL,
  version TEXT NOT NULL,
  fixed_version TEXT,
  status TEXT,
  description TEXT,
  links TEXT,
  project_id INTEGER NOT NULL,
  repository_name TEXT NOT NULL,
  digest TEXT NOT NULL,
  tags TEXT,
  in_use BOOLEAN NOT NULL DEFAULT FALSE,
  matching_containers TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cve_id, package, version, digest)
);

CREATE INDEX IF NOT EXISTS idx_harbor_vuln_severity ON harbor_vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_harbor_vuln_cve ON harbor_vulnerabilities(cve_id);
CREATE INDEX IF NOT EXISTS idx_harbor_vuln_in_use ON harbor_vulnerabilities(in_use);
CREATE INDEX IF NOT EXISTS idx_harbor_vuln_repo ON harbor_vulnerabilities(repository_name);
CREATE INDEX IF NOT EXISTS idx_harbor_vuln_synced ON harbor_vulnerabilities(synced_at);

-- CVE exception management with justification and audit trail
CREATE TABLE IF NOT EXISTS harbor_vulnerability_exceptions (
  id SERIAL PRIMARY KEY,
  cve_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project', 'repository')),
  scope_ref TEXT,
  justification TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  synced_to_harbor BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cve_id, scope, scope_ref)
);

CREATE INDEX IF NOT EXISTS idx_harbor_exc_cve ON harbor_vulnerability_exceptions(cve_id);
CREATE INDEX IF NOT EXISTS idx_harbor_exc_active ON harbor_vulnerability_exceptions(is_active);
CREATE INDEX IF NOT EXISTS idx_harbor_exc_expires ON harbor_vulnerability_exceptions(expires_at);

-- Sync status tracking for Harbor vulnerability data
CREATE TABLE IF NOT EXISTS harbor_sync_status (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  vulnerabilities_synced INTEGER NOT NULL DEFAULT 0,
  in_use_matched INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_harbor_sync_status ON harbor_sync_status(status);
CREATE INDEX IF NOT EXISTS idx_harbor_sync_started ON harbor_sync_status(started_at);
