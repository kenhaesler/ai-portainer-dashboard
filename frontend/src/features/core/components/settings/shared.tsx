import { useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export const REDACTED_SECRET = '••••••••';

// Default settings definitions
export const DEFAULT_SETTINGS = {
  monitoring: [
    { key: 'monitoring.polling_interval', label: 'Polling Interval', description: 'How often to fetch container metrics (seconds)', type: 'number', defaultValue: '30', min: 5, max: 300 },
    { key: 'monitoring.metric_retention_days', label: 'Metric Retention', description: 'How long to keep historical metrics (days)', type: 'number', defaultValue: '7', min: 1, max: 90 },
    { key: 'monitoring.enabled', label: 'Enable Monitoring', description: 'Enable background container monitoring', type: 'boolean', defaultValue: 'true' },
    { key: 'monitoring.scheduler_interval_minutes', label: 'Scheduler Interval', description: 'How often the monitoring scheduler runs (minutes). Changes apply without restart.', type: 'number', defaultValue: '5', min: 1, max: 60 },
  ],
  anomaly: [
    { key: 'anomaly.cpu_threshold', label: 'CPU Threshold', description: 'CPU usage percentage to trigger anomaly alert', type: 'number', defaultValue: '85', min: 50, max: 100 },
    { key: 'anomaly.memory_threshold', label: 'Memory Threshold', description: 'Memory usage percentage to trigger anomaly alert', type: 'number', defaultValue: '85', min: 50, max: 100 },
    { key: 'anomaly.network_spike_threshold', label: 'Network Spike Threshold', description: 'Network traffic spike multiplier to trigger alert', type: 'number', defaultValue: '3', min: 1.5, max: 10 },
    { key: 'anomaly.detection_enabled', label: 'Enable Anomaly Detection', description: 'Enable automatic anomaly detection', type: 'boolean', defaultValue: 'true' },
  ],
  notifications: [
    { key: 'notifications.teams_enabled', label: 'Enable Teams Notifications', description: 'Send alerts to Microsoft Teams via webhook', type: 'boolean', defaultValue: 'false' },
    { key: 'notifications.teams_webhook_url', label: 'Teams Webhook URL', description: 'Microsoft Teams incoming webhook URL', type: 'password', defaultValue: '' },
    { key: 'notifications.email_enabled', label: 'Enable Email Notifications', description: 'Send alerts via SMTP email', type: 'boolean', defaultValue: 'false' },
    // SMTP Host is intentionally env-only (SMTP_HOST) for SSRF protection.
    // The backend ignores DB overrides via getSafeSmtpHost().
    { key: 'notifications.smtp_port', label: 'SMTP Port', description: 'SMTP server port', type: 'number', defaultValue: '587', min: 1, max: 65535 },
    { key: 'notifications.smtp_user', label: 'SMTP Username', description: 'SMTP authentication username', type: 'string', defaultValue: '' },
    { key: 'notifications.smtp_password', label: 'SMTP Password', description: 'SMTP authentication password', type: 'password', defaultValue: '' },
    { key: 'notifications.email_recipients', label: 'Email Recipients', description: 'Comma-separated list of recipient email addresses', type: 'string', defaultValue: '' },
    { key: 'notifications.discord_enabled', label: 'Enable Discord Notifications', description: 'Send alerts to Discord via webhook', type: 'boolean', defaultValue: 'false' },
    { key: 'notifications.discord_webhook_url', label: 'Discord Webhook URL', description: 'Discord channel incoming webhook URL (https://discord.com/api/webhooks/...)', type: 'password', defaultValue: '' },
    { key: 'notifications.telegram_enabled', label: 'Enable Telegram Notifications', description: 'Send alerts via Telegram Bot API', type: 'boolean', defaultValue: 'false' },
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
    { key: 'oidc.enabled', label: 'Enable OIDC/SSO', description: 'Enable OpenID Connect single sign-on authentication', type: 'boolean', defaultValue: 'false' },
    { key: 'oidc.issuer_url', label: 'Issuer URL', description: 'OIDC provider issuer URL (e.g., https://auth.example.com/realms/master)', type: 'string', defaultValue: '' },
    { key: 'oidc.client_id', label: 'Client ID', description: 'OIDC client identifier registered with your provider', type: 'string', defaultValue: '' },
    { key: 'oidc.client_secret', label: 'Client Secret', description: 'OIDC client secret for server-side authentication', type: 'password', defaultValue: '' },
    { key: 'oidc.redirect_uri', label: 'Redirect URI', description: 'Callback URL registered with your IdP. Leave blank to inherit from DASHBOARD_EXTERNAL_URL — when that env var is set, it takes precedence and the value here is ignored.', type: 'string', defaultValue: '' },
    { key: 'oidc.scopes', label: 'Scopes', description: 'Space-separated OIDC scopes to request', type: 'string', defaultValue: 'openid profile email' },
    { key: 'oidc.local_auth_enabled', label: 'Keep Local Auth Enabled', description: 'Allow username/password login alongside SSO', type: 'boolean', defaultValue: 'true' },
    { key: 'oidc.groups_claim', label: 'Groups Claim', description: 'ID token claim name containing group membership (e.g., groups, roles, or a custom claim)', type: 'string', defaultValue: 'groups' },
    { key: 'oidc.group_role_mappings', label: 'Group-to-Role Mappings', description: 'JSON mapping of IdP group names to dashboard roles. Use * as a wildcard fallback.', type: 'string', defaultValue: '{}' },
    { key: 'oidc.auto_provision', label: 'Auto-Provision OIDC Users', description: 'Automatically create user records for new OIDC-authenticated users', type: 'boolean', defaultValue: 'true' },
    { key: 'oidc.allow_insecure_transport', label: 'Allow Insecure Transport (HTTP)', description: '⚠ Permit plain-HTTP OIDC discovery and token exchange. Auth codes and tokens travel unencrypted — enable ONLY for local development against an HTTP-only IdP. Never enable in production.', type: 'boolean', defaultValue: 'false' },
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
    { key: 'elasticsearch.verify_ssl', label: 'Verify SSL', description: 'Verify SSL certificates when connecting', type: 'boolean', defaultValue: 'true' },
  ],
  statusPage: [
    { key: 'status.page.enabled', label: 'Enable Status Page', description: 'Serve a public status page at /status (no authentication required)', type: 'boolean', defaultValue: 'false' },
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
    { key: 'infrastructure.metrics_retention_days', label: 'Metrics Retention (days)', description: 'Default retention period for container metrics', type: 'number', defaultValue: '7', min: 1, max: 365 },
    { key: 'infrastructure.metrics_raw_retention_days', label: 'Raw Metrics Retention (days)', description: 'Retention for raw per-minute metrics', type: 'number', defaultValue: '7', min: 1, max: 90 },
    { key: 'infrastructure.metrics_rollup_5min_retention_days', label: '5min Rollup Retention (days)', description: 'Retention for 5-minute aggregated metrics', type: 'number', defaultValue: '30', min: 1, max: 365 },
    { key: 'infrastructure.metrics_rollup_1hour_retention_days', label: '1h Rollup Retention (days)', description: 'Retention for hourly aggregated metrics', type: 'number', defaultValue: '90', min: 1, max: 730 },
    { key: 'infrastructure.metrics_rollup_1day_retention_days', label: '1d Rollup Retention (days)', description: 'Retention for daily aggregated metrics', type: 'number', defaultValue: '365', min: 1, max: 1825 },
    { key: 'infrastructure.insights_retention_days', label: 'Insights Retention (days)', description: 'How long to keep AI-generated insights', type: 'number', defaultValue: '7', min: 1, max: 365 },
  ],
  portainerBackup: [
    { key: 'portainer_backup.enabled', label: 'Enable Scheduled Backups', description: 'Automatically back up Portainer server configuration on a schedule', type: 'boolean', defaultValue: 'false' },
    { key: 'portainer_backup.interval_hours', label: 'Backup Interval (hours)', description: 'Hours between automated Portainer backups', type: 'number', defaultValue: '24', min: 1, max: 168 },
    { key: 'portainer_backup.max_count', label: 'Max Backups to Retain', description: 'Maximum number of Portainer backups to keep (oldest deleted first)', type: 'number', defaultValue: '10', min: 1, max: 50 },
    { key: 'portainer_backup.password', label: 'Backup Password', description: 'Optional encryption password for Portainer backups', type: 'password', defaultValue: '' },
  ],
  edgeAgent: [
    { key: 'edge.staleness_threshold_minutes', label: 'Staleness Threshold', description: 'Minutes since last Edge Agent check-in before data is marked stale', type: 'number', defaultValue: '5', min: 1, max: 60 },
    { key: 'edge.checkin_warning_multiplier', label: 'Check-in Warning Multiplier', description: 'Show warning when time since last check-in exceeds this multiple of the check-in interval', type: 'number', defaultValue: '3', min: 2, max: 10 },
    // Live Docker-info fallback (issue #1249) — Portainer EE doesn't persist
    // Snapshots[] for Edge Standard endpoints, so we fall back to live tunnel
    // queries. Tunable so large fleets don't hammer Portainer's chisel tunnel.
    { key: 'edge.live_query_enabled', label: 'Live Container Counts Fallback', description: 'Fetch live Docker info via the chisel tunnel when an Edge Standard endpoint has no snapshot (#1249). Disable to keep the legacy behavior (0/0/0 counts).', type: 'boolean', defaultValue: 'true' },
    { key: 'edge.live_query_concurrency', label: 'Live Fetch Concurrency', description: 'Max parallel live /docker/info calls across Edge endpoints. Keep low (1–3) for large fleets to avoid stampeding Portainer.', type: 'number', defaultValue: '2', min: 1, max: 20 },
    { key: 'edge.live_query_interval_seconds', label: 'Live Fetch Interval (seconds)', description: 'Cache TTL per endpoint. The dashboard returns stale data instantly while refreshing in the background.', type: 'number', defaultValue: '60', min: 15, max: 3600 },
    { key: 'edge.live_query_timeout_ms', label: 'Live Fetch Timeout (ms)', description: 'Per-call timeout — a slow agent never blocks the dashboard.', type: 'number', defaultValue: '5000', min: 1000, max: 30000 },
  ],
  harbor: [
    { key: 'harbor.enabled', label: 'Enable Harbor Integration', description: 'Enable vulnerability management via Harbor Registry', type: 'boolean', defaultValue: 'false' },
    { key: 'harbor.api_url', label: 'Harbor API URL', description: 'URL of your Harbor Registry (e.g., https://harbor.example.com)', type: 'string', defaultValue: '' },
    { key: 'harbor.robot_name', label: 'Robot Account Name', description: 'Harbor robot account username (e.g., robot$dashboard)', type: 'string', defaultValue: '' },
    { key: 'harbor.robot_secret', label: 'Robot Account Secret', description: 'Harbor robot account secret/password', type: 'password', defaultValue: '' },
    { key: 'harbor.verify_ssl', label: 'Verify SSL', description: 'Verify SSL certificates when connecting to Harbor', type: 'boolean', defaultValue: 'true' },
    { key: 'harbor.sync_interval_minutes', label: 'Sync Interval (minutes)', description: 'How often to sync vulnerabilities from Harbor', type: 'number', defaultValue: '30', min: 5, max: 1440 },
  ],
} as const;

export type SettingCategory = keyof typeof DEFAULT_SETTINGS;

export const SETTING_CATEGORY_BY_KEY: Record<string, SettingCategory> = Object.entries(DEFAULT_SETTINGS).reduce(
  (acc, [category, settings]) => {
    settings.forEach((setting) => {
      acc[setting.key] = category as SettingCategory;
    });
    return acc;
  },
  {} as Record<string, SettingCategory>,
);

/** Common props passed down to all settings tab components */
export interface SettingsTabProps {
  editedValues: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  isSaving: boolean;
}

interface SettingInputProps {
  setting: (typeof DEFAULT_SETTINGS)[SettingCategory][number];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SettingInput({ setting, value, onChange, disabled }: SettingInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  if (setting.type === 'boolean') {
    return (
      <button
        onClick={() => onChange(value === 'true' ? 'false' : 'true')}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          value === 'true' ? 'bg-primary' : 'bg-muted',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
            value === 'true' ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </button>
    );
  }

  if (setting.type === 'password') {
    return (
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="••••••••"
          className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  const inputProps = {
    type: setting.type === 'number' ? 'number' : 'text',
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    disabled,
    className: 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
    ...('min' in setting && { min: setting.min }),
    ...('max' in setting && { max: setting.max }),
    ...('step' in setting && { step: setting.step }),
  };

  return <input {...inputProps} />;
}

interface SettingRowProps {
  setting: (typeof DEFAULT_SETTINGS)[SettingCategory][number];
  value: string;
  onChange: (value: string) => void;
  hasChanges: boolean;
  disabled?: boolean;
}

export function SettingRow({ setting, value, onChange, hasChanges, disabled }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div className="flex-1 pr-4">
        <div className="flex items-center gap-2">
          <label className="font-medium">{setting.label}</label>
          {hasChanges && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{setting.description}</p>
      </div>
      <div className="shrink-0 w-72">
        <SettingInput setting={setting} value={value} onChange={onChange} disabled={disabled} />
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
