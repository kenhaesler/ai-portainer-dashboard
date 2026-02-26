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
    { key: 'notifications.smtp_host', label: 'SMTP Host', description: 'SMTP server hostname', type: 'string', defaultValue: '' },
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
    { key: 'llm.model', label: 'LLM Model', description: 'Model to use for AI features', type: 'string', defaultValue: 'llama3.2' },
    { key: 'llm.temperature', label: 'Temperature', description: 'Creativity of LLM responses (0-1)', type: 'number', defaultValue: '0.7', min: 0, max: 1, step: 0.1 },
    { key: 'llm.ollama_url', label: 'Ollama URL', description: 'URL of the Ollama server', type: 'string', defaultValue: 'http://host.docker.internal:11434' },
    { key: 'llm.max_tokens', label: 'Max Tokens', description: 'Maximum tokens in LLM response', type: 'number', defaultValue: '20000', min: 256, max: 128000 },
    { key: 'llm.custom_endpoint_enabled', label: 'Custom Endpoint Enabled', description: 'Use a custom OpenAI-compatible API endpoint', type: 'boolean', defaultValue: 'false' },
    { key: 'llm.custom_endpoint_url', label: 'Custom Endpoint URL', description: 'OpenAI-compatible chat completions URL', type: 'string', defaultValue: '' },
    { key: 'llm.custom_endpoint_token', label: 'Custom Endpoint Token', description: 'Bearer token for custom endpoint', type: 'password', defaultValue: '' },
    { key: 'llm.auth_type', label: 'Auth Type', description: 'Authentication header type (Bearer for most LLM proxies including ParisNeo Ollama Proxy)', type: 'string', defaultValue: 'bearer' },
  ],
  authentication: [
    { key: 'oidc.enabled', label: 'Enable OIDC/SSO', description: 'Enable OpenID Connect single sign-on authentication', type: 'boolean', defaultValue: 'false' },
    { key: 'oidc.issuer_url', label: 'Issuer URL', description: 'OIDC provider issuer URL (e.g., https://auth.example.com/realms/master)', type: 'string', defaultValue: '' },
    { key: 'oidc.client_id', label: 'Client ID', description: 'OIDC client identifier registered with your provider', type: 'string', defaultValue: '' },
    { key: 'oidc.client_secret', label: 'Client Secret', description: 'OIDC client secret for server-side authentication', type: 'password', defaultValue: '' },
    { key: 'oidc.redirect_uri', label: 'Redirect URI', description: 'Callback URL (e.g., http://localhost:5273/auth/callback)', type: 'string', defaultValue: '' },
    { key: 'oidc.scopes', label: 'Scopes', description: 'Space-separated OIDC scopes to request', type: 'string', defaultValue: 'openid profile email' },
    { key: 'oidc.local_auth_enabled', label: 'Keep Local Auth Enabled', description: 'Allow username/password login alongside SSO', type: 'boolean', defaultValue: 'true' },
    { key: 'oidc.groups_claim', label: 'Groups Claim', description: 'ID token claim name containing group membership (e.g., groups, roles, or a custom claim)', type: 'string', defaultValue: 'groups' },
    { key: 'oidc.group_role_mappings', label: 'Group-to-Role Mappings', description: 'JSON mapping of IdP group names to dashboard roles. Use * as a wildcard fallback.', type: 'string', defaultValue: '{}' },
    { key: 'oidc.auto_provision', label: 'Auto-Provision OIDC Users', description: 'Automatically create user records for new OIDC-authenticated users', type: 'boolean', defaultValue: 'true' },
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
  portainerBackup: [
    { key: 'portainer_backup.enabled', label: 'Enable Scheduled Backups', description: 'Automatically back up Portainer server configuration on a schedule', type: 'boolean', defaultValue: 'false' },
    { key: 'portainer_backup.interval_hours', label: 'Backup Interval (hours)', description: 'Hours between automated Portainer backups', type: 'number', defaultValue: '24', min: 1, max: 168 },
    { key: 'portainer_backup.max_count', label: 'Max Backups to Retain', description: 'Maximum number of Portainer backups to keep (oldest deleted first)', type: 'number', defaultValue: '10', min: 1, max: 50 },
    { key: 'portainer_backup.password', label: 'Backup Password', description: 'Optional encryption password for Portainer backups', type: 'password', defaultValue: '' },
  ],
  edgeAgent: [
    { key: 'edge.staleness_threshold_minutes', label: 'Staleness Threshold', description: 'Minutes since last Edge Agent check-in before data is marked stale', type: 'number', defaultValue: '5', min: 1, max: 60 },
    { key: 'edge.checkin_warning_multiplier', label: 'Check-in Warning Multiplier', description: 'Show warning when time since last check-in exceeds this multiple of the check-in interval', type: 'number', defaultValue: '3', min: 2, max: 10 },
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
            disabled={disabled}
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
