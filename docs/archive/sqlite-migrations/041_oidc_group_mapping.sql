-- OIDC group-to-role mapping settings
-- Allows administrators to map IdP groups to dashboard roles (viewer, operator, admin)
INSERT OR IGNORE INTO settings (key, value, category) VALUES
  ('oidc.groups_claim', 'groups', 'authentication'),
  ('oidc.group_role_mappings', '{}', 'authentication'),
  ('oidc.auto_provision', 'true', 'authentication');
