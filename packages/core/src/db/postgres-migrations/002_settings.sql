-- PostgreSQL migration: settings table
-- Converted from SQLite migrations 002, 008, 024, 030, 040, 041

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

-- Seed: OIDC defaults (from 008_oidc_seed.sql)
INSERT INTO settings (key, value, category) VALUES
  ('oidc.enabled', 'false', 'authentication'),
  ('oidc.issuer_url', '', 'authentication'),
  ('oidc.client_id', '', 'authentication'),
  ('oidc.client_secret', '', 'authentication'),
  ('oidc.redirect_uri', '', 'authentication'),
  ('oidc.scopes', 'openid profile email', 'authentication'),
  ('oidc.local_auth_enabled', 'true', 'authentication')
ON CONFLICT (key) DO NOTHING;

-- Seed: security audit ignore list (from 024_security_audit_ignore_list.sql)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('security_audit_ignore_list',
   '["portainer","portainer_edge_agent","traefik","nginx*","caddy*","prometheus*","grafana*"]',
   'security', NOW())
ON CONFLICT (key) DO NOTHING;

-- Seed: active prompt profile (from 032_prompt_profiles.sql)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('prompts.active_profile', 'default', 'prompts', NOW())
ON CONFLICT (key) DO NOTHING;

-- Seed: infrastructure service patterns (from 040_reports_infrastructure_patterns.sql)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('reports.infrastructure_service_patterns',
   '["traefik","portainer_agent","beyla"]',
   'reports', NOW())
ON CONFLICT (key) DO NOTHING;

-- Seed: OIDC group mapping settings (from 041_oidc_group_mapping.sql)
INSERT INTO settings (key, value, category) VALUES
  ('oidc.groups_claim', 'groups', 'authentication'),
  ('oidc.group_role_mappings', '{}', 'authentication'),
  ('oidc.auto_provision', 'true', 'authentication')
ON CONFLICT (key) DO NOTHING;
