INSERT INTO settings (key, value, category, updated_at)
SELECT
  'reports.infrastructure_service_patterns',
  '["traefik","portainer_agent","beyla"]',
  'reports',
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM settings WHERE key = 'reports.infrastructure_service_patterns'
);

