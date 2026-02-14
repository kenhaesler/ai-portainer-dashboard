INSERT OR IGNORE INTO settings (key, value, category) VALUES
  ('oidc.enabled', 'false', 'authentication'),
  ('oidc.issuer_url', '', 'authentication'),
  ('oidc.client_id', '', 'authentication'),
  ('oidc.client_secret', '', 'authentication'),
  ('oidc.redirect_uri', '', 'authentication'),
  ('oidc.scopes', 'openid profile email', 'authentication'),
  ('oidc.local_auth_enabled', 'true', 'authentication');
