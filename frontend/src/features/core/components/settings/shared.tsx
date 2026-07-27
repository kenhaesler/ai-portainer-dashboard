import { createContext, useContext, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export const REDACTED_SECRET = '••••••••';

/**
 * Blast radius of a setting, for the settings that have one.
 *
 * Most of the 107 keys are recoverable: get a cache TTL wrong and you pay a
 * cache miss. These two classes are not, so they are rendered with their own
 * chrome and — critically — excluded from auto-save. Nothing here changes what
 * a setting *does*; it only changes how much friction stands in front of it.
 *
 * - `security`    — changes who can reach the dashboard, or how credentials travel.
 * - `destructive` — *lowering* the value permanently deletes stored data.
 */
/**
 * How much attention a setting's consequence deserves.
 *
 * `security` used to cover every OIDC/TLS row and rendered an identical red
 * chip reading "Security" on all fifteen of them — on a tab already named
 * Security. Uniform emphasis is no emphasis: "Auth codes and tokens travel
 * unencrypted … never enable this in production" ranked exactly level with
 * "Client ID must match the client registered with your IdP", which is a typo
 * warning. `danger` is reserved for the few settings that can expose
 * credentials or lock everyone out, so red means something again.
 */
export type SettingRisk = 'danger' | 'security' | 'destructive';

// Default settings definitions
export const DEFAULT_SETTINGS = {
  monitoring: [
    { key: 'monitoring.polling_interval', label: 'Polling Interval', description: 'How often to fetch container metrics (seconds)', type: 'number', defaultValue: '30', min: 5, max: 300 },
    { key: 'monitoring.metric_retention_days', label: 'Metric Retention', description: 'How long to keep historical metrics (days)', type: 'number', defaultValue: '7', min: 1, max: 90, risk: 'destructive', consequence: 'Lowering this deletes stored metrics older than the new window. Deleted history does not come back if you raise it again.' },
    { key: 'monitoring.enabled', label: 'Enable Monitoring', description: 'Runs the detection cycle that produces insights, anomalies and notifications. Off means nothing is evaluated and no alerts fire.', type: 'boolean', defaultValue: 'true' },
    { key: 'monitoring.scheduler_interval_minutes', label: 'Scheduler Interval', description: 'How often the monitoring scheduler runs (minutes). Changes apply without restart.', type: 'number', defaultValue: '5', min: 1, max: 60 },
  ],
  anomaly: [
    { key: 'anomaly.cpu_threshold', label: 'CPU Threshold', description: 'CPU usage percentage to trigger anomaly alert', type: 'number', defaultValue: '85', min: 50, max: 100 },
    { key: 'anomaly.memory_threshold', label: 'Memory Threshold', description: 'Memory usage percentage to trigger anomaly alert', type: 'number', defaultValue: '85', min: 50, max: 100 },
    { key: 'anomaly.network_spike_threshold', label: 'Network Spike Threshold', description: 'Network traffic spike multiplier to trigger alert', type: 'number', defaultValue: '3', min: 1.5, max: 10 },
    { key: 'anomaly.detection_enabled', label: 'Enable Anomaly Detection', description: 'Compares each container against its own recent baseline. Off leaves the fixed thresholds above as the only source of anomaly insights.', type: 'boolean', defaultValue: 'true' },
  ],
  notifications: [
    { key: 'notifications.teams_enabled', label: 'Enable Teams Notifications', description: 'Posts every critical and warning insight to a Teams channel. One message per insight, rate-limited by the anomaly cooldown.', type: 'boolean', defaultValue: 'false' },
    { key: 'notifications.teams_webhook_url', label: 'Teams Webhook URL', description: 'Microsoft Teams incoming webhook URL', type: 'password', defaultValue: '' },
    { key: 'notifications.email_enabled', label: 'Enable Email Notifications', description: 'Emails every critical and warning insight to the recipients below. The SMTP host is set with the SMTP_HOST environment variable only — it cannot be pointed at an internal host from this page.', type: 'boolean', defaultValue: 'false' },
    // SMTP Host is intentionally env-only (SMTP_HOST) for SSRF protection.
    // The backend ignores DB overrides via getSafeSmtpHost().
    { key: 'notifications.smtp_port', label: 'SMTP Port', description: 'Usually 587 for STARTTLS or 465 for implicit TLS.', type: 'number', defaultValue: '587', min: 1, max: 65535 },
    { key: 'notifications.smtp_user', label: 'SMTP Username', description: 'Leave blank if your relay accepts unauthenticated mail from this host.', type: 'string', defaultValue: '' },
    { key: 'notifications.smtp_password', label: 'SMTP Password', description: 'Stored encrypted. Leave blank when the username is blank.', type: 'password', defaultValue: '' },
    { key: 'notifications.email_recipients', label: 'Email Recipients', description: 'Comma-separated list of recipient email addresses', type: 'string', defaultValue: '' },
    { key: 'notifications.discord_enabled', label: 'Enable Discord Notifications', description: 'Posts every critical and warning insight to a Discord channel. One message per insight, rate-limited by the anomaly cooldown.', type: 'boolean', defaultValue: 'false' },
    { key: 'notifications.discord_webhook_url', label: 'Discord Webhook URL', description: 'Discord channel incoming webhook URL (https://discord.com/api/webhooks/...)', type: 'password', defaultValue: '' },
    { key: 'notifications.telegram_enabled', label: 'Enable Telegram Notifications', description: 'Sends every critical and warning insight to the chat below. One message per insight, rate-limited by the anomaly cooldown.', type: 'boolean', defaultValue: 'false' },
    { key: 'notifications.telegram_bot_token', label: 'Telegram Bot Token', description: 'Bot token from @BotFather (format: 123456:ABC-DEF...)', type: 'password', defaultValue: '' },
    { key: 'notifications.telegram_chat_id', label: 'Telegram Chat ID', description: 'Chat, group, or channel ID to receive notifications', type: 'string', defaultValue: '' },
  ],
  cache: [
    { key: 'cache.container_ttl', label: 'Container Cache TTL', description: 'Time to cache container list (seconds)', type: 'number', defaultValue: '30', min: 5, max: 300 },
    { key: 'cache.metrics_ttl', label: 'Metrics Cache TTL', description: 'Time to cache metric data (seconds)', type: 'number', defaultValue: '10', min: 5, max: 60 },
    { key: 'cache.image_ttl', label: 'Image Cache TTL', description: 'Time to cache image list (seconds)', type: 'number', defaultValue: '60', min: 30, max: 600 },
  ],
  llm: [
    { key: 'llm.api_url', label: 'API Endpoint URL', description: 'Base URL of an OpenAI-compatible server. /v1/chat/completions is appended automatically.', type: 'string', defaultValue: '' },
    { key: 'llm.api_token', label: 'API Token', description: 'Bearer token (or username:password for Basic auth) for the LLM endpoint', type: 'password', defaultValue: '' },
    { key: 'llm.auth_type', label: 'Auth Type', description: 'Authentication header type — Bearer (default) or Basic.', type: 'string', defaultValue: 'bearer' },
    { key: 'llm.model', label: 'LLM Model', description: 'Model to use for AI features', type: 'string', defaultValue: 'gpt-4o-mini' },
    { key: 'llm.temperature', label: 'Temperature', description: 'Creativity of LLM responses (0-1)', type: 'number', defaultValue: '0.7', min: 0, max: 1, step: 0.1 },
    { key: 'llm.max_tokens', label: 'Max Tokens', description: 'Maximum tokens in LLM response', type: 'number', defaultValue: '20000', min: 256, max: 128000 },
  ],
  authentication: [
    { key: 'oidc.enabled', label: 'Enable OIDC/SSO', description: 'Enable OpenID Connect single sign-on authentication', type: 'boolean', defaultValue: 'false', risk: 'security', consequence: 'Switches the sign-in path for every user. A misconfigured provider locks out everyone who has no local password.' },
    { key: 'oidc.issuer_url', label: 'Issuer URL', description: 'OIDC provider issuer URL (e.g., https://auth.example.com/realms/master)', type: 'string', defaultValue: '', risk: 'security', consequence: 'A wrong issuer fails discovery, and every SSO login fails until it is corrected and the backend restarts.' },
    { key: 'oidc.client_id', label: 'Client ID', description: 'OIDC client identifier registered with your provider', type: 'string', defaultValue: '', risk: 'security', consequence: 'Must match the client registered with your IdP, or every SSO login is rejected at the provider.' },
    { key: 'oidc.client_secret', label: 'Client Secret', description: 'OIDC client secret for server-side authentication', type: 'password', defaultValue: '', risk: 'security', consequence: 'A wrong value fails every login. A leaked value lets someone else impersonate this dashboard to your IdP.' },
    { key: 'oidc.redirect_uri', label: 'Redirect URI', description: 'Callback URL registered with your IdP. Leave blank to inherit from DASHBOARD_EXTERNAL_URL — when that env var is set, it takes precedence and the value here is ignored.', type: 'string', defaultValue: '', risk: 'security', consequence: 'Must be registered verbatim with the IdP. A mismatch fails the callback after the user has already authenticated.' },
    { key: 'oidc.scopes', label: 'Scopes', description: 'Space-separated OIDC scopes to request', type: 'string', defaultValue: 'openid profile email', risk: 'security', consequence: 'Dropping a scope your mappings depend on (the groups scope, typically) leaves every login with no groups and no mapped role.' },
    { key: 'oidc.local_auth_enabled', label: 'Keep Local Auth Enabled', description: 'Allow username/password login alongside SSO', type: 'boolean', defaultValue: 'true', risk: 'danger', consequence: 'Turning this off removes the username/password fallback. If the IdP is unreachable, nobody can sign in.' },
    { key: 'oidc.groups_claim', label: 'Groups Claim', description: 'ID token claim name containing group membership. Supports dot-notation for nested claims (e.g., realm_access.roles)', type: 'string', defaultValue: 'groups', risk: 'security', consequence: 'A claim name your IdP does not send means no group ever matches, and every login falls through to the unmapped-user rule.' },
    { key: 'oidc.group_role_mappings', label: 'Group-to-Role Mappings', description: 'JSON mapping of IdP group names to dashboard roles. Use * as a wildcard fallback.', type: 'string', defaultValue: '{}', risk: 'security', consequence: 'This is what decides who gets admin. A downgrade revokes the affected users’ live sessions immediately.' },
    { key: 'oidc.allow_unmapped_viewer', label: 'Grant viewer role to all IDP users', description: 'When on, IDP users whose groups match no mapping keep access — new users get viewer, existing users keep their current role. When off, only users in a defined group (or any user, if a * wildcard mapping is set) can sign in; everyone else is denied. Local auth is unaffected.', type: 'boolean', defaultValue: 'false', risk: 'danger', consequence: 'On: anyone your IdP authenticates keeps access, mapped or not. Off: unmatched users are denied and their existing sessions are revoked.' },
    { key: 'oidc.auto_provision', label: 'Auto-Provision OIDC Users', description: 'Automatically create user records for new OIDC-authenticated users', type: 'boolean', defaultValue: 'true', risk: 'security', consequence: 'Creates a dashboard account for every new IdP user who signs in, without an admin approving it.' },
    { key: 'oidc.allow_insecure_transport', label: 'Allow Insecure Transport (HTTP)', description: 'Permit plain-HTTP OIDC discovery and token exchange. Intended only for local development against an HTTP-only IdP.', type: 'boolean', defaultValue: 'false', risk: 'danger', consequence: 'Auth codes and tokens travel unencrypted. Anyone on the network path can capture and replay them. Never enable this in production.' },
  ],
  webhooks: [
    { key: 'webhooks.enabled', label: 'Enable Webhooks', description: 'Enable outbound webhook event delivery', type: 'boolean', defaultValue: 'false' },
    { key: 'webhooks.max_retries', label: 'Max Retries', description: 'Maximum delivery attempts for failed webhooks', type: 'number', defaultValue: '5', min: 0, max: 10 },
    { key: 'webhooks.retry_interval', label: 'Retry Interval', description: 'Seconds between webhook retry checks', type: 'number', defaultValue: '60', min: 10, max: 600 },
  ],
  elasticsearch: [
    { key: 'elasticsearch.enabled', label: 'Enable Elasticsearch', description: 'Enable container-origin log forwarding and Elasticsearch search integration', type: 'boolean', defaultValue: 'false' },
    { key: 'elasticsearch.endpoint', label: 'Elasticsearch URL', description: 'URL of your Elasticsearch cluster (e.g., https://localhost:9200)', type: 'string', defaultValue: '' },
    { key: 'elasticsearch.api_key', label: 'API Key', description: 'Elasticsearch API key for authentication (keep blank for no auth)', type: 'password', defaultValue: '' },
    { key: 'elasticsearch.index_pattern', label: 'Index Pattern', description: 'Index pattern for log searching (e.g., logs-* or filebeat-*)', type: 'string', defaultValue: 'logs-*' },
    { key: 'elasticsearch.verify_ssl', label: 'Verify SSL', description: 'Verify SSL certificates when connecting', type: 'boolean', defaultValue: 'true', risk: 'danger', consequence: 'Off accepts any certificate, including one presented by a man-in-the-middle holding your API key.' },
  ],
  statusPage: [
    { key: 'status.page.enabled', label: 'Enable Status Page', description: 'Serve a public status page at /status (no authentication required)', type: 'boolean', defaultValue: 'false', risk: 'danger', consequence: 'Publishes /status to anyone who can reach this host, with no sign-in. Endpoint health and incident history become public.' },
    { key: 'status.page.title', label: 'Page Title', description: 'Title displayed on the public status page', type: 'string', defaultValue: 'System Status' },
    { key: 'status.page.description', label: 'Page Description', description: 'Optional description shown below the title', type: 'string', defaultValue: '' },
    { key: 'status.page.show_incidents', label: 'Show Incidents', description: 'Display recent incidents on the status page', type: 'boolean', defaultValue: 'true' },
    { key: 'status.page.refresh_interval', label: 'Auto-Refresh Interval', description: 'How often the status page auto-refreshes (seconds)', type: 'number', defaultValue: '30', min: 10, max: 300 },
  ],
  mcp: [
    { key: 'mcp.tool_timeout', label: 'Tool Timeout', description: 'Maximum execution time for MCP tool calls (seconds)', type: 'number', defaultValue: '60', min: 1, max: 600 },
    { key: 'llm.max_tool_iterations', label: 'Max Tool Iterations', description: 'Maximum number of tool call rounds the LLM can perform per message (higher = more complex tasks)', type: 'number', defaultValue: '3', min: 1, max: 20 },
  ],
  aiTuning: [
    // Anomaly Detection
    { key: 'ai_tuning.anomaly_detection_method', label: 'Detection Method', description: 'Algorithm for statistical anomaly detection (zscore, bollinger, adaptive)', type: 'string', defaultValue: 'adaptive' },
    { key: 'ai_tuning.anomaly_zscore_threshold', label: 'Z-Score Threshold', description: 'Standard deviations from the mean to trigger an anomaly alert', type: 'number', defaultValue: '3.5', min: 0.5, max: 10, step: 0.1 },
    { key: 'ai_tuning.anomaly_moving_average_window', label: 'Moving Average Window', description: 'Number of data points for the rolling average baseline', type: 'number', defaultValue: '20', min: 5, max: 200 },
    { key: 'ai_tuning.anomaly_min_samples', label: 'Min Samples', description: 'Minimum data points required before anomaly detection activates', type: 'number', defaultValue: '10', min: 3, max: 100 },
    { key: 'ai_tuning.anomaly_cooldown_minutes', label: 'Alert Cooldown (min)', description: 'Minutes to suppress repeated alerts for the same container+metric', type: 'number', defaultValue: '30', min: 0, max: 1440 },
    { key: 'ai_tuning.anomaly_threshold_pct', label: 'Hard Threshold %', description: 'Absolute usage percentage that always triggers a warning', type: 'number', defaultValue: '85', min: 50, max: 100 },
    { key: 'ai_tuning.anomaly_hard_threshold_enabled', label: 'Hard Threshold Enabled', description: 'Flag values above the hard threshold regardless of statistical detection', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.bollinger_bands_enabled', label: 'Bollinger Bands', description: 'Enable Bollinger Bands for low-variance workload detection', type: 'boolean', defaultValue: 'true' },
    // Predictive Alerting
    { key: 'ai_tuning.predictive_alerting_enabled', label: 'Predictive Alerting', description: 'Proactively warn about resource exhaustion trends', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.predictive_alert_threshold_hours', label: 'Prediction Horizon (hours)', description: 'Alert when resource exhaustion is predicted within this timeframe', type: 'number', defaultValue: '24', min: 1, max: 168 },
    // Anomaly Explanation
    { key: 'ai_tuning.anomaly_explanation_enabled', label: 'LLM Anomaly Explanations', description: 'Use LLM to generate plain-English explanations of anomalies', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.anomaly_explanation_max_per_cycle', label: 'Max Explanations / Cycle', description: 'Maximum number of anomalies explained by LLM per monitoring cycle', type: 'number', defaultValue: '5', min: 1, max: 50 },
    // Isolation Forest
    { key: 'ai_tuning.isolation_forest_enabled', label: 'Isolation Forest ML', description: 'Enable multivariate ML-based anomaly detection', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.isolation_forest_retrain_hours', label: 'Retrain Interval (hours)', description: 'Hours between Isolation Forest model retraining', type: 'number', defaultValue: '6', min: 1, max: 168 },
    // NLP Log Analysis
    { key: 'ai_tuning.nlp_log_analysis_enabled', label: 'NLP Log Analysis', description: 'LLM-powered container log error pattern detection', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.nlp_log_analysis_max_per_cycle', label: 'Max Containers / Cycle', description: 'Maximum containers to analyze logs for per cycle', type: 'number', defaultValue: '3', min: 1, max: 20 },
    { key: 'ai_tuning.nlp_log_analysis_tail_lines', label: 'Log Tail Lines', description: 'Number of recent log lines to send to the LLM', type: 'number', defaultValue: '100', min: 10, max: 500 },
    // Smart Grouping
    { key: 'ai_tuning.smart_grouping_enabled', label: 'Smart Alert Grouping', description: 'Group semantically similar anomalies into incidents', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.smart_grouping_similarity_threshold', label: 'Similarity Threshold', description: 'Text similarity threshold for grouping (0-1, lower = more aggressive)', type: 'number', defaultValue: '0.3', min: 0.1, max: 1.0, step: 0.05 },
    { key: 'ai_tuning.incident_summary_enabled', label: 'LLM Incident Summaries', description: 'Generate LLM-powered summaries for correlated incidents', type: 'boolean', defaultValue: 'true' },
    // Investigation
    { key: 'ai_tuning.investigation_enabled', label: 'Root Cause Investigation', description: 'Auto-trigger LLM-powered root cause analysis for anomalies', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.investigation_cooldown_minutes', label: 'Investigation Cooldown (min)', description: 'Minimum minutes between investigations for the same container', type: 'number', defaultValue: '20', min: 1, max: 1440 },
    { key: 'ai_tuning.investigation_max_concurrent', label: 'Max Concurrent', description: 'Maximum investigations running simultaneously', type: 'number', defaultValue: '2', min: 1, max: 10 },
    { key: 'ai_tuning.investigation_log_tail_lines', label: 'Evidence Log Lines', description: 'Log lines collected as evidence for investigations', type: 'number', defaultValue: '50', min: 10, max: 500 },
    { key: 'ai_tuning.investigation_metrics_window_minutes', label: 'Metrics Window (min)', description: 'Time window for metrics evidence collection', type: 'number', defaultValue: '60', min: 5, max: 1440 },
    { key: 'ai_tuning.investigation_min_severity', label: 'Min Severity', description: 'Minimum insight severity to trigger investigation (critical, warning, info)', type: 'string', defaultValue: 'warning' },
    // General AI
    { key: 'ai_tuning.ai_analysis_enabled', label: 'AI Infrastructure Analysis', description: 'Fire-and-forget LLM analysis each monitoring cycle', type: 'boolean', defaultValue: 'true' },
    { key: 'ai_tuning.max_insights_per_cycle', label: 'Max Insights / Cycle', description: 'Cap on total insights generated per monitoring cycle', type: 'number', defaultValue: '500', min: 1, max: 10000 },
    { key: 'ai_tuning.log_analysis_concurrency', label: 'Log Analysis Concurrency', description: 'Parallel container log analysis tasks', type: 'number', defaultValue: '3', min: 1, max: 20 },
  ],
  metricsRetention: [
    { key: 'infrastructure.metrics_retention_days', label: 'Metrics Retention (days)', description: 'Default retention period for container metrics', type: 'number', defaultValue: '7', min: 1, max: 365, risk: 'destructive', consequence: 'Lowering this deletes container metrics older than the new window on the next cleanup run.' },
    { key: 'infrastructure.metrics_raw_retention_days', label: 'Raw Metrics Retention (days)', description: 'Retention for raw per-minute metrics', type: 'number', defaultValue: '7', min: 1, max: 90, risk: 'destructive', consequence: 'Lowering this deletes per-minute samples older than the new window. It also caps the day-of-week anomaly baseline, which cannot look back further than raw retention.' },
    { key: 'infrastructure.metrics_rollup_5min_retention_days', label: '5min Rollup Retention (days)', description: 'Retention for 5-minute aggregated metrics', type: 'number', defaultValue: '30', min: 1, max: 365, risk: 'destructive', consequence: 'Lowering this deletes 5-minute rollups older than the new window.' },
    { key: 'infrastructure.metrics_rollup_1hour_retention_days', label: '1h Rollup Retention (days)', description: 'Retention for hourly aggregated metrics', type: 'number', defaultValue: '90', min: 1, max: 730, risk: 'destructive', consequence: 'Lowering this deletes hourly rollups older than the new window — the series most long-range charts read from.' },
    { key: 'infrastructure.metrics_rollup_1day_retention_days', label: '1d Rollup Retention (days)', description: 'Retention for daily aggregated metrics', type: 'number', defaultValue: '365', min: 1, max: 1825, risk: 'destructive', consequence: 'Lowering this deletes daily rollups older than the new window — the longest history the dashboard keeps.' },
    { key: 'infrastructure.insights_retention_days', label: 'Insights Retention (days)', description: 'How long to keep AI-generated insights', type: 'number', defaultValue: '7', min: 1, max: 365, risk: 'destructive', consequence: 'Lowering this deletes insights older than the new window, along with their acknowledgements.' },
  ],
  portainerBackup: [
    { key: 'portainer_backup.enabled', label: 'Enable Scheduled Backups', description: 'Automatically back up Portainer server configuration on a schedule', type: 'boolean', defaultValue: 'false' },
    { key: 'portainer_backup.interval_hours', label: 'Backup Interval (hours)', description: 'Hours between automated Portainer backups', type: 'number', defaultValue: '24', min: 1, max: 168 },
    { key: 'portainer_backup.max_count', label: 'Max Backups to Retain', description: 'Maximum number of Portainer backups to keep (oldest deleted first)', type: 'number', defaultValue: '10', min: 1, max: 50, risk: 'destructive', consequence: 'Lowering this deletes the oldest backup archives until only this many remain. There is no restore from this dashboard.' },
    { key: 'portainer_backup.password', label: 'Backup Password', description: 'Optional encryption password for Portainer backups', type: 'password', defaultValue: '' },
  ],
  edgeAgent: [
    { key: 'edge.staleness_threshold_minutes', label: 'Staleness Threshold', description: 'Minutes since last Edge Agent check-in before data is marked stale', type: 'number', defaultValue: '5', min: 1, max: 60 },
    { key: 'edge.checkin_warning_multiplier', label: 'Check-in Warning Multiplier', description: 'Show warning when time since last check-in exceeds this multiple of the check-in interval', type: 'number', defaultValue: '3', min: 2, max: 10 },
    // Live container data (all Docker endpoints) — reads /docker/info live via
    // Portainer as the primary data source. Tunable so large fleets don't
    // hammer Portainer.
    { key: 'edge.live_query_enabled', label: 'Live Container Data', description: 'Read container counts and host CPU/memory live via /docker/info through Portainer (primary source — replaces stale snapshots). Disabling shows endpoints as "data unavailable".', type: 'boolean', defaultValue: 'true' },
    { key: 'edge.live_query_concurrency', label: 'Live Fetch Concurrency', description: 'Max parallel live /docker/info calls across endpoints. Keep low (1–3) for large fleets to avoid stampeding Portainer.', type: 'number', defaultValue: '2', min: 1, max: 20 },
    { key: 'edge.live_query_interval_seconds', label: 'Live Fetch Interval (seconds)', description: 'Per-endpoint cache TTL. The dashboard returns cached data instantly while refreshing in the background.', type: 'number', defaultValue: '60', min: 15, max: 3600 },
    { key: 'edge.live_query_timeout_ms', label: 'Live Fetch Timeout (ms)', description: 'Per-call timeout — a slow agent never blocks the dashboard.', type: 'number', defaultValue: '5000', min: 1000, max: 30000 },
  ],
  harbor: [
    { key: 'harbor.enabled', label: 'Enable Harbor Integration', description: 'Enable vulnerability management via Harbor Registry', type: 'boolean', defaultValue: 'false' },
    { key: 'harbor.api_url', label: 'Harbor API URL', description: 'URL of your Harbor Registry (e.g., https://harbor.example.com)', type: 'string', defaultValue: '' },
    { key: 'harbor.robot_name', label: 'Robot Account Name', description: 'Harbor robot account username (e.g., robot$dashboard)', type: 'string', defaultValue: '' },
    { key: 'harbor.robot_secret', label: 'Robot Account Secret', description: 'Harbor robot account secret/password', type: 'password', defaultValue: '' },
    { key: 'harbor.verify_ssl', label: 'Verify SSL', description: 'Verify SSL certificates when connecting to Harbor', type: 'boolean', defaultValue: 'true', risk: 'danger', consequence: 'Off accepts any certificate, including one presented by a man-in-the-middle holding your robot account secret.' },
    { key: 'harbor.sync_interval_minutes', label: 'Sync Interval (minutes)', description: 'How often to sync vulnerabilities from Harbor', type: 'number', defaultValue: '30', min: 5, max: 1440 },
  ],
} as const;

export type SettingCategory = keyof typeof DEFAULT_SETTINGS;

/** One entry of {@link DEFAULT_SETTINGS}, whichever category it came from. */
export type SettingDescriptor = (typeof DEFAULT_SETTINGS)[SettingCategory][number];

export const SETTING_CATEGORY_BY_KEY: Record<string, SettingCategory> = Object.entries(DEFAULT_SETTINGS).reduce(
  (acc, [category, settings]) => {
    settings.forEach((setting) => {
      acc[setting.key] = category as SettingCategory;
    });
    return acc;
  },
  {} as Record<string, SettingCategory>,
);

export const SETTING_BY_KEY: Record<string, SettingDescriptor> = Object.values(DEFAULT_SETTINGS).reduce(
  (acc, settings) => {
    (settings as readonly SettingDescriptor[]).forEach((setting) => {
      acc[setting.key] = setting;
    });
    return acc;
  },
  {} as Record<string, SettingDescriptor>,
);

/** The risk class of a setting, or `undefined` for the ordinary majority. */
export function settingRisk(setting: SettingDescriptor | undefined): SettingRisk | undefined {
  if (setting && 'risk' in setting) return setting.risk as SettingRisk;
  return undefined;
}

/** The one-line consequence of getting a risky setting wrong, if it has one. */
export function settingConsequence(setting: SettingDescriptor | undefined): string | undefined {
  if (setting && 'consequence' in setting) return setting.consequence as string;
  return undefined;
}

/**
 * Keys that must never be committed by the debounce.
 *
 * Auto-save is right for cosmetics and wrong for anything that changes who can
 * sign in or deletes stored history — a paused keystroke should not be able to
 * publish an unauthenticated status page or drop 83 days of metrics.
 */
export const GUARDED_SETTING_KEYS: ReadonlySet<string> = new Set(
  Object.values(SETTING_BY_KEY).filter((s) => settingRisk(s) !== undefined).map((s) => s.key),
);

export function isGuardedSetting(key: string): boolean {
  return GUARDED_SETTING_KEYS.has(key);
}

/**
 * True when a pending edit to a `destructive` setting *shrinks* its window —
 * the only direction that deletes anything. Raising a retention window is safe.
 */
export function shrinksRetentionWindow(key: string, nextValue: string, previousValue: string): boolean {
  if (settingRisk(SETTING_BY_KEY[key]) !== 'destructive') return false;
  // A blank field is an unfinished edit, not a lowered window — `Number('')` is 0
  // and would otherwise read as the largest shrink possible.
  if (nextValue.trim() === '' || previousValue.trim() === '') return false;
  const next = Number(nextValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(next) || !Number.isFinite(previous)) return false;
  return next < previous;
}

export interface SettingSearchMatch {
  key: string;
  label: string;
  description: string;
  category: SettingCategory;
  risk?: SettingRisk;
}

/**
 * Find settings by label, description or key.
 *
 * 107 keys across 7 tabs, and the only way to find one was to read every tab.
 * Ranked so a label match beats a description match — searching "retention"
 * should put "Metrics Retention (days)" above a setting that merely mentions it.
 */
export function searchSettings(query: string, limit = 8): SettingSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const scored: { match: SettingSearchMatch; score: number }[] = [];
  for (const [key, setting] of Object.entries(SETTING_BY_KEY)) {
    const label = setting.label.toLowerCase();
    const description = setting.description.toLowerCase();
    let score = 0;
    if (label.startsWith(needle)) score = 4;
    else if (label.includes(needle)) score = 3;
    else if (key.toLowerCase().includes(needle)) score = 2;
    else if (description.includes(needle)) score = 1;
    if (score === 0) continue;
    scored.push({
      score,
      match: {
        key,
        label: setting.label,
        description: setting.description,
        category: SETTING_CATEGORY_BY_KEY[key],
        risk: settingRisk(setting),
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.match.label.localeCompare(b.match.label))
    .slice(0, limit)
    .map((entry) => entry.match);
}

/** Common props passed down to all settings tab components */
export interface SettingsTabProps {
  editedValues: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  isSaving: boolean;
}

interface SettingInputProps {
  setting: SettingDescriptor;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** DOM id, so the row's `<label>` can point at the control. */
  id?: string;
  /** Ids of the description / consequence text describing this control. */
  describedBy?: string;
}

export function SettingInput({ setting, value, onChange, disabled, id, describedBy }: SettingInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  if (setting.type === 'boolean') {
    const checked = value === 'true';
    return (
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={setting.label}
        aria-describedby={describedBy}
        onClick={() => onChange(checked ? 'false' : 'true')}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          checked ? 'bg-primary' : 'bg-muted',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </button>
    );
  }

  if (setting.type === 'password') {
    return (
      <div className="relative">
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={describedBy}
          placeholder="••••••••"
          className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? `Hide ${setting.label}` : `Show ${setting.label}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  const inputProps = {
    id,
    type: setting.type === 'number' ? 'number' : 'text',
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    disabled,
    'aria-describedby': describedBy,
    className: 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
    ...('min' in setting && { min: setting.min }),
    ...('max' in setting && { max: setting.max }),
    ...('step' in setting && { step: setting.step }),
  };

  return <input {...inputProps} />;
}

/**
 * Keys saved in the last few seconds, so a row can confirm at the row.
 *
 * The page-level "All changes saved" banner sits up to 2000px above the field
 * being edited on the longer tabs, which means the only confirmation that a
 * security setting committed is off-screen. Provided by the settings page;
 * rows that render outside it simply never show the pill.
 */
const SettingsSavedKeysContext = createContext<ReadonlySet<string>>(new Set<string>());

export function SettingsSavedKeysProvider({
  savedKeys,
  children,
}: {
  savedKeys: ReadonlySet<string>;
  children: React.ReactNode;
}) {
  return (
    <SettingsSavedKeysContext.Provider value={savedKeys}>{children}</SettingsSavedKeysContext.Provider>
  );
}

/** DOM-id-safe form of a setting key (`oidc.client_id` → `setting-oidc-client_id`). */
export function settingDomId(key: string): string {
  return `setting-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

const RISK_CHROME: Record<SettingRisk, { rule: string; chip: string; label: string | null; text: string }> = {
  danger: {
    rule: 'border-l-2 border-l-destructive/70 pl-3 -ml-px',
    chip: 'bg-destructive/10 text-destructive',
    label: 'Weakens security',
    text: 'text-destructive',
  },
  security: {
    // No chip: the tab is called Security, so a chip on every row repeats the
    // heading fifteen times. The left rule still groups them, and the
    // consequence line still explains what breaks — in muted text, so the
    // genuinely dangerous rows above are the only red on the page.
    rule: 'border-l-2 border-l-border pl-3 -ml-px',
    chip: '',
    label: null,
    text: 'text-muted-foreground',
  },
  destructive: {
    rule: 'border-l-2 border-l-amber-500/70 pl-3 -ml-px',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    label: 'Deletes data',
    text: 'text-amber-600 dark:text-amber-400',
  },
};

interface SettingRowProps {
  setting: SettingDescriptor;
  value: string;
  onChange: (value: string) => void;
  hasChanges: boolean;
  disabled?: boolean;
}

export function SettingRow({ setting, value, onChange, hasChanges, disabled }: SettingRowProps) {
  const savedKeys = useContext(SettingsSavedKeysContext);
  const risk = settingRisk(setting);
  const consequence = settingConsequence(setting);
  const chrome = risk ? RISK_CHROME[risk] : undefined;
  const inputId = settingDomId(setting.key);
  const descriptionId = `${inputId}-description`;
  const consequenceId = `${inputId}-consequence`;
  const justSaved = savedKeys.has(setting.key);

  return (
    <div
      data-testid={`setting-row-${setting.key}`}
      data-risk={risk ?? undefined}
      className="flex items-center justify-between py-4 border-b border-border last:border-0"
    >
      <div className={cn('flex-1 pr-4', chrome?.rule)}>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="font-medium">{setting.label}</label>
          {chrome?.label && (
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', chrome.chip)}>
              {chrome.label}
            </span>
          )}
          {hasChanges && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {risk ? 'Unsaved' : 'Modified'}
            </span>
          )}
          {justSaved && !hasChanges && (
            <span
              data-testid={`setting-saved-${setting.key}`}
              className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
            >
              Saved
            </span>
          )}
        </div>
        <p id={descriptionId} className="text-sm text-muted-foreground mt-0.5">{setting.description}</p>
        {consequence && (
          <p id={consequenceId} className={cn('mt-1 text-sm', chrome?.text)}>
            {consequence}
          </p>
        )}
      </div>
      <div className="shrink-0 w-72">
        <SettingInput
          setting={setting}
          value={value}
          onChange={onChange}
          disabled={disabled}
          id={inputId}
          describedBy={consequence ? `${descriptionId} ${consequenceId}` : descriptionId}
        />
      </div>
    </div>
  );
}

interface SettingsSectionProps {
  title: string;
  icon: React.ReactNode;
  category: SettingCategory;
  settings: (typeof DEFAULT_SETTINGS)[SettingCategory];
  values: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  requiresRestart?: boolean;
  disabled?: boolean;
  // Per-key disabled overrides. A row is disabled if the section is disabled
  // OR its key is present here — used when a value is being supplied from
  // outside the DB (env var, computed default) and editing would have no
  // effect.
  disabledKeys?: ReadonlySet<string>;
  footerContent?: React.ReactNode;
  status?: 'configured' | 'not-configured';
  statusLabel?: string;
}

export function SettingsSection({
  title,
  icon,
  category,
  settings,
  values,
  originalValues,
  onChange,
  requiresRestart,
  disabled,
  disabledKeys,
  footerContent,
  status,
  statusLabel,
}: SettingsSectionProps) {
  const hasChanges = settings.some(
    (s) => values[s.key] !== originalValues[s.key]
  );

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
                status === 'configured'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
              )}
            >
              {statusLabel ?? (status === 'configured' ? 'Configured' : 'Not configured')}
            </span>
          )}
          {requiresRestart && hasChanges && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
              <RefreshCw className="h-3 w-3" />
              Requires restart
            </div>
          )}
        </div>
      </div>
      <div className="px-4">
        {settings.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            value={values[setting.key] ?? setting.defaultValue}
            onChange={(value) => onChange(setting.key, value)}
            hasChanges={values[setting.key] !== originalValues[setting.key]}
            disabled={disabled || disabledKeys?.has(setting.key)}
          />
        ))}
      </div>
      {footerContent && (
        <div className="border-t border-border p-4">
          {footerContent}
        </div>
      )}
    </div>
  );
}
