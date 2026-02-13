INSERT INTO settings (key, value, category, updated_at)
SELECT
  'security_audit_ignore_list',
  '["portainer","portainer_edge_agent","traefik","nginx*","caddy*","prometheus*","grafana*"]',
  'security',
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM settings WHERE key = 'security_audit_ignore_list'
);
