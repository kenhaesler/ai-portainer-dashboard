import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Palette,
  Monitor,
  Sun,
  Moon,
  Sparkles,
  Activity,
  AlertTriangle,
  Database,
  Bot,
  Save,
  Loader2,
  RefreshCw,
  Settings2,
  Info,
  CheckCircle2,
  Search,
  Shield,
  Eye,
  EyeOff,
  Bell,
  Send,
  Webhook,
  Globe,
  Wifi,
  WifiOff,
  HardDriveDownload,
  Clock,
  Trash2,
  Download,
  Archive,
  Users,
} from 'lucide-react';
import { useThemeStore, themeOptions, dashboardBackgroundOptions, type Theme, type DashboardBackground } from '@/stores/theme-store';
import { useSettings, useUpdateSetting } from '@/hooks/use-settings';
import { useCacheStats, useCacheClear } from '@/hooks/use-cache-admin';
import { useLlmModels, useLlmTestConnection } from '@/hooks/use-llm-models';
import type { LlmModel } from '@/hooks/use-llm-models';
import {
  usePortainerBackups,
  useCreatePortainerBackup,
  useDeletePortainerBackup,
  downloadPortainerBackup,
} from '@/hooks/use-portainer-backups';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { ThemedSelect } from '@/components/shared/themed-select';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

const LazyUsersPanel = lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPanel })));
const LazyWebhooksPanel = lazy(() => import('@/pages/webhooks').then((m) => ({ default: m.WebhooksPanel })));

// Default settings definitions
const DEFAULT_SETTINGS = {
  monitoring: [
    { key: 'monitoring.polling_interval', label: 'Polling Interval', description: 'How often to fetch container metrics (seconds)', type: 'number', defaultValue: '30', min: 5, max: 300 },
    { key: 'monitoring.metric_retention_days', label: 'Metric Retention', description: 'How long to keep historical metrics (days)', type: 'number', defaultValue: '7', min: 1, max: 90 },
    { key: 'monitoring.enabled', label: 'Enable Monitoring', description: 'Enable background container monitoring', type: 'boolean', defaultValue: 'true' },
  ],
  anomaly: [
    { key: 'anomaly.cpu_threshold', label: 'CPU Threshold', description: 'CPU usage percentage to trigger anomaly alert', type: 'number', defaultValue: '80', min: 50, max: 100 },
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
    { key: 'llm.max_tokens', label: 'Max Tokens', description: 'Maximum tokens in LLM response', type: 'number', defaultValue: '2048', min: 256, max: 8192 },
    { key: 'llm.custom_endpoint_enabled', label: 'Custom Endpoint Enabled', description: 'Use a custom OpenAI-compatible API endpoint', type: 'boolean', defaultValue: 'false' },
    { key: 'llm.custom_endpoint_url', label: 'Custom Endpoint URL', description: 'OpenAI-compatible chat completions URL', type: 'string', defaultValue: '' },
    { key: 'llm.custom_endpoint_token', label: 'Custom Endpoint Token', description: 'Bearer token for custom endpoint', type: 'password', defaultValue: '' },
  ],
  authentication: [
    { key: 'oidc.enabled', label: 'Enable OIDC/SSO', description: 'Enable OpenID Connect single sign-on authentication', type: 'boolean', defaultValue: 'false' },
    { key: 'oidc.issuer_url', label: 'Issuer URL', description: 'OIDC provider issuer URL (e.g., https://auth.example.com/realms/master)', type: 'string', defaultValue: '' },
    { key: 'oidc.client_id', label: 'Client ID', description: 'OIDC client identifier registered with your provider', type: 'string', defaultValue: '' },
    { key: 'oidc.client_secret', label: 'Client Secret', description: 'OIDC client secret for server-side authentication', type: 'password', defaultValue: '' },
    { key: 'oidc.redirect_uri', label: 'Redirect URI', description: 'Callback URL (e.g., http://localhost:5173/auth/callback)', type: 'string', defaultValue: '' },
    { key: 'oidc.scopes', label: 'Scopes', description: 'Space-separated OIDC scopes to request', type: 'string', defaultValue: 'openid profile email' },
    { key: 'oidc.local_auth_enabled', label: 'Keep Local Auth Enabled', description: 'Allow username/password login alongside SSO', type: 'boolean', defaultValue: 'true' },
  ],
  webhooks: [
    { key: 'webhooks.enabled', label: 'Enable Webhooks', description: 'Enable outbound webhook event delivery', type: 'boolean', defaultValue: 'false' },
    { key: 'webhooks.max_retries', label: 'Max Retries', description: 'Maximum delivery attempts for failed webhooks', type: 'number', defaultValue: '5', min: 0, max: 10 },
    { key: 'webhooks.retry_interval', label: 'Retry Interval', description: 'Seconds between webhook retry checks', type: 'number', defaultValue: '60', min: 10, max: 600 },
  ],
  elasticsearch: [
    { key: 'elasticsearch.enabled', label: 'Enable Elasticsearch', description: 'Enable Elasticsearch/Kibana integration for edge agent logs', type: 'boolean', defaultValue: 'false' },
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
  portainerBackup: [
    { key: 'portainer_backup.enabled', label: 'Enable Scheduled Backups', description: 'Automatically back up Portainer server configuration on a schedule', type: 'boolean', defaultValue: 'false' },
    { key: 'portainer_backup.interval_hours', label: 'Backup Interval (hours)', description: 'Hours between automated Portainer backups', type: 'number', defaultValue: '24', min: 1, max: 168 },
    { key: 'portainer_backup.max_count', label: 'Max Backups to Retain', description: 'Maximum number of Portainer backups to keep (oldest deleted first)', type: 'number', defaultValue: '10', min: 1, max: 50 },
    { key: 'portainer_backup.password', label: 'Backup Password', description: 'Optional encryption password for Portainer backups', type: 'password', defaultValue: '' },
  ],
} as const;

const LANDING_PAGE_OPTIONS = [
  { value: '/', label: 'Home' },
  { value: '/workloads', label: 'Workload Explorer' },
  { value: '/fleet', label: 'Fleet Overview' },
  { value: '/ai-monitor', label: 'AI Monitor' },
  { value: '/metrics', label: 'Metrics Dashboard' },
  { value: '/remediation', label: 'Remediation' },
  { value: '/assistant', label: 'LLM Assistant' },
] as const;

type SettingCategory = keyof typeof DEFAULT_SETTINGS;

interface CacheStatsSummary {
  backend: 'multi-layer' | 'memory-only';
  l1Size: number;
  l2Size: number;
}

export function getRedisSystemInfo(cacheStats?: CacheStatsSummary) {
  if (!cacheStats) {
    return {
      status: 'Unknown',
      details: 'Cache stats unavailable',
      keys: 'N/A',
    };
  }

  const redisEnabled = cacheStats.backend === 'multi-layer';
  return {
    status: redisEnabled ? 'Active' : 'Inactive (Memory fallback)',
    details: redisEnabled
      ? 'Using Redis + in-memory cache'
      : 'Using in-memory cache only',
    keys: redisEnabled ? String(cacheStats.l2Size) : 'N/A',
  };
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'system') return <Monitor className="h-4 w-4" />;
  if (theme === 'apple-light') return <Sun className="h-4 w-4" />;
  if (theme === 'apple-dark') return <Sparkles className="h-4 w-4" />;
  if (theme.startsWith('catppuccin')) return <Palette className="h-4 w-4" />;
  return <Moon className="h-4 w-4" />;
}

interface SettingInputProps {
  setting: (typeof DEFAULT_SETTINGS)[SettingCategory][number];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function SettingInput({ setting, value, onChange, disabled }: SettingInputProps) {
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
    ...(setting.type === 'number' && {
      min: 'min' in setting ? setting.min : undefined,
      max: 'max' in setting ? setting.max : undefined,
      step: 'step' in setting ? setting.step : 1,
    }),
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

function SettingRow({ setting, value, onChange, hasChanges, disabled }: SettingRowProps) {
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
      <div className="shrink-0">
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
}

function SettingsSection({
  title,
  icon,
  category,
  settings,
  values,
  originalValues,
  onChange,
  requiresRestart,
  disabled,
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
        {requiresRestart && hasChanges && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
            <RefreshCw className="h-3 w-3" />
            Requires restart
          </div>
        )}
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
    </div>
  );
}

interface LlmSettingsSectionProps {
  values: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

export function LlmSettingsSection({ values, originalValues, onChange, disabled }: LlmSettingsSectionProps) {
  const ollamaUrl = values['llm.ollama_url'] || 'http://host.docker.internal:11434';
  const selectedModel = values['llm.model'] || 'llama3.2';
  const temperature = values['llm.temperature'] || '0.7';
  const maxTokens = values['llm.max_tokens'] || '2048';
  const customEnabled = values['llm.custom_endpoint_enabled'] === 'true';
  const customUrl = values['llm.custom_endpoint_url'] || '';
  const customToken = values['llm.custom_endpoint_token'] || '';

  // Fetch models from the user's configured Ollama URL
  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useLlmModels(ollamaUrl);
  const testConnection = useLlmTestConnection();
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  // Connection status is driven by explicit Test Connection, not by the models query
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>();

  const models: LlmModel[] = modelsData?.models ?? [];

  const hasChanges = [
    'llm.model', 'llm.temperature', 'llm.ollama_url', 'llm.max_tokens',
    'llm.custom_endpoint_enabled', 'llm.custom_endpoint_url', 'llm.custom_endpoint_token',
  ].some((key) => values[key] !== originalValues[key]);

  const handleScanModels = () => {
    void queryClient.invalidateQueries({ queryKey: ['llm-models', ollamaUrl] });
    void refetchModels();
  };

  const handleTestConnection = () => {
    const body = customEnabled && customUrl
      ? { url: customUrl, token: customToken }
      : { ollamaUrl: ollamaUrl };
    testConnection.mutate(body, {
      onSuccess: (data) => {
        if (data.ok) {
          setConnectionStatus('ok');
          setConnectionError(undefined);
          toast.success(`Connection successful${data.models?.length ? ` — ${data.models.length} model(s) available` : ''}`);
        } else {
          setConnectionStatus('error');
          setConnectionError(data.error);
          toast.error(`Connection failed: ${data.error || 'Unknown error'}`);
        }
      },
      onError: (err) => {
        setConnectionStatus('error');
        setConnectionError(err.message);
        toast.error(`Connection test failed: ${err.message}`);
      },
    });
  };

  const connectionIcon = connectionStatus === 'ok'
    ? <Wifi className="h-4 w-4 text-emerald-500" />
    : connectionStatus === 'error'
      ? <WifiOff className="h-4 w-4 text-red-500" />
      : <Info className="h-4 w-4 text-muted-foreground" />;

  const connectionLabel = connectionStatus === 'ok'
    ? 'Connected'
    : connectionStatus === 'error'
      ? 'Connection Failed'
      : 'Not tested';

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <h2 className="text-lg font-semibold">LLM / Ollama</h2>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
              <RefreshCw className="h-3 w-3" />
              Requires restart
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Connection Status */}
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {testConnection.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : connectionIcon}
              <div>
                <p className="text-sm font-medium">
                  {testConnection.isPending ? 'Testing...' : connectionLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  {connectionStatus === 'error' && connectionError
                    ? connectionError
                    : customEnabled ? customUrl || 'No custom URL set' : ollamaUrl}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testConnection.isPending || disabled}
                className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {testConnection.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wifi className="h-3.5 w-3.5" />
                )}
                Test Connection
              </button>
            </div>
          </div>
          {connectionStatus === 'ok' && testConnection.data?.models && testConnection.data.models.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {testConnection.data.models.length} model{testConnection.data.models.length !== 1 ? 's' : ''} available on server
            </p>
          )}
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="llm-model-select" className="font-medium">Model</label>
              <p className="text-sm text-muted-foreground mt-0.5">Select the LLM model for AI features</p>
            </div>
            <button
              type="button"
              onClick={handleScanModels}
              disabled={modelsLoading || disabled}
              className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {modelsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Scan Models
            </button>
          </div>

          {models.length > 0 ? (
            <ThemedSelect
              id="llm-model-select"
              value={selectedModel}
              onValueChange={(val) => onChange('llm.model', val)}
              disabled={disabled}
              options={[
                ...models.map((m) => ({
                  value: m.name,
                  label: `${m.name}${m.size ? ` (${formatBytes(m.size)})` : ''}`,
                })),
                ...(selectedModel && !models.some((m) => m.name === selectedModel)
                  ? [{ value: selectedModel, label: selectedModel }]
                  : []),
              ]}
              className="w-full"
            />
          ) : (
            <input
              id="llm-model-select"
              type="text"
              value={selectedModel}
              onChange={(e) => onChange('llm.model', e.target.value)}
              disabled={disabled}
              placeholder="Enter model name (e.g., llama3.2)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          )}
          {!modelsLoading && models.length === 0 && (
            <p className="text-xs text-amber-500">Could not fetch models. Enter model name manually or click Scan Models.</p>
          )}
        </div>

        {/* Ollama URL */}
        <div className="flex items-center justify-between py-4 border-t border-border">
          <div className="flex-1 pr-4">
            <label className="font-medium">Ollama URL</label>
            <p className="text-sm text-muted-foreground mt-0.5">URL of the Ollama server</p>
          </div>
          <div className="shrink-0 w-72">
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => onChange('llm.ollama_url', e.target.value)}
              disabled={disabled}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
        </div>

        {/* Temperature */}
        <div className="flex items-center justify-between py-4 border-t border-border">
          <div className="flex-1 pr-4">
            <label className="font-medium">Temperature</label>
            <p className="text-sm text-muted-foreground mt-0.5">Creativity of LLM responses (0-1)</p>
          </div>
          <div className="shrink-0">
            <input
              type="number"
              value={temperature}
              onChange={(e) => onChange('llm.temperature', e.target.value)}
              disabled={disabled}
              min={0}
              max={1}
              step={0.1}
              className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
        </div>

        {/* Max Tokens */}
        <div className="flex items-center justify-between py-4 border-t border-border">
          <div className="flex-1 pr-4">
            <label className="font-medium">Max Tokens</label>
            <p className="text-sm text-muted-foreground mt-0.5">Maximum tokens in LLM response</p>
          </div>
          <div className="shrink-0">
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => onChange('llm.max_tokens', e.target.value)}
              disabled={disabled}
              min={256}
              max={8192}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
        </div>

        {/* Custom API Endpoint */}
        <div className="border-t border-border pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium">Custom API Endpoint</label>
              <p className="text-sm text-muted-foreground mt-0.5">
                Use an OpenAI-compatible API instead of the Ollama SDK
              </p>
            </div>
            <button
              type="button"
              onClick={() => onChange('llm.custom_endpoint_enabled', customEnabled ? 'false' : 'true')}
              disabled={disabled}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                customEnabled ? 'bg-primary' : 'bg-muted',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
              aria-label="Toggle custom API endpoint"
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  customEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {customEnabled && (
            <div className="space-y-4 rounded-lg border border-border p-4 bg-muted/30">
              <div>
                <label htmlFor="custom-endpoint-url" className="text-sm font-medium">API Endpoint URL</label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  OpenAI-compatible chat completions URL (e.g., https://api.openai.com/v1/chat/completions)
                </p>
                <input
                  id="custom-endpoint-url"
                  type="text"
                  value={customUrl}
                  onChange={(e) => onChange('llm.custom_endpoint_url', e.target.value)}
                  disabled={disabled}
                  placeholder="https://api.example.com/v1/chat/completions"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="custom-endpoint-token" className="text-sm font-medium">API Key / Bearer Token</label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Authentication token for the custom endpoint
                </p>
                <div className="relative">
                  <input
                    id="custom-endpoint-token"
                    type={showToken ? 'text' : 'password'}
                    value={customToken}
                    onChange={(e) => onChange('llm.custom_endpoint_token', e.target.value)}
                    disabled={disabled}
                    placeholder="sk-..."
                    className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotificationTestButtons() {
  const [testingTeams, setTestingTeams] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  const handleTest = async (channel: 'teams' | 'email') => {
    const setTesting = channel === 'teams' ? setTestingTeams : setTestingEmail;
    setTesting(true);
    try {
      const result = await api.post<{ success: boolean; error?: string }>('/api/notifications/test', { channel });
      if (result.success) {
        toast.success(`Test ${channel} notification sent successfully`);
      } else {
        toast.error(`Failed to send test ${channel} notification: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      toast.error(`Failed to send test ${channel} notification: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <Info className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground">Send a test notification to verify your configuration:</span>
      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={() => handleTest('teams')}
          disabled={testingTeams}
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {testingTeams ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Test Teams
        </button>
        <button
          onClick={() => handleTest('email')}
          disabled={testingEmail}
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {testingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Test Email
        </button>
      </div>
    </div>
  );
}

interface NotificationHistoryEntry {
  id: number;
  channel: 'teams' | 'email';
  event_type: string;
  title: string;
  body: string;
  severity: string;
  status: 'sent' | 'failed';
  error: string | null;
  container_name: string | null;
  created_at: string;
}

interface NotificationHistoryResponse {
  entries: NotificationHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

type ChannelFilter = 'all' | 'teams' | 'email';
type StatusFilter = 'all' | 'sent' | 'failed';
type DateRangeFilter = 'all' | '24h' | '7d' | '30d';

export function NotificationHistoryPanel() {
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>('7d');

  const fetchHistory = async (channel: ChannelFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number | undefined> = {
        limit: 200,
        offset: 0,
        channel: channel === 'all' ? undefined : channel,
      };
      const response = await api.get<NotificationHistoryResponse>('/api/notifications/history', { params });
      setEntries(response.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHistory(channelFilter);
  }, [channelFilter]);

  const filteredEntries = useMemo(() => {
    const now = Date.now();

    return entries.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) {
        return false;
      }

      if (dateRangeFilter !== 'all') {
        const createdAt = new Date(entry.created_at).getTime();
        const ageMs = now - createdAt;
        const thresholds: Record<Exclude<DateRangeFilter, 'all'>, number> = {
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
          '30d': 30 * 24 * 60 * 60 * 1000,
        };
        if (ageMs > thresholds[dateRangeFilter]) {
          return false;
        }
      }

      return true;
    });
  }, [dateRangeFilter, entries, statusFilter]);

  const sentCount = filteredEntries.filter((entry) => entry.status === 'sent').length;
  const failedCount = filteredEntries.filter((entry) => entry.status === 'failed').length;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Notification History</h2>
        </div>
        <button
          type="button"
          onClick={() => void fetchHistory(channelFilter)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      <div className="border-b p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Channel
            </label>
            <ThemedSelect
              value={channelFilter}
              onValueChange={(val) => setChannelFilter(val as ChannelFilter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'teams', label: 'Teams' },
                { value: 'email', label: 'Email' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </label>
            <ThemedSelect
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val as StatusFilter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'sent', label: 'Sent' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Date Range
            </label>
            <ThemedSelect
              value={dateRangeFilter}
              onValueChange={(val) => setDateRangeFilter(val as DateRangeFilter)}
              options={[
                { value: '24h', label: 'Last 24 Hours' },
                { value: '7d', label: 'Last 7 Days' },
                { value: '30d', label: 'Last 30 Days' },
                { value: 'all', label: 'All Time' },
              ]}
            />
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-700 dark:text-emerald-400">Sent: {sentCount}</span>
            <span className="rounded-full bg-red-500/15 px-2 py-1 text-red-700 dark:text-red-400">Failed: {failedCount}</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="p-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
            <p className="font-medium text-destructive">Failed to load notification history</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="space-y-2 p-4">
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-medium">No notification history found</p>
          <p className="mt-1 text-sm text-muted-foreground">Try adjusting channel, status, or date filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Channel</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Event</th>
                <th className="px-4 py-2.5 font-medium">Message</th>
                <th className="px-4 py-2.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs capitalize">
                      {entry.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-1 text-xs font-medium',
                        entry.status === 'sent'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-red-500/15 text-red-700 dark:text-red-400'
                      )}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{entry.title}</p>
                    <p className="text-xs text-muted-foreground">{entry.event_type}</p>
                  </td>
                  <td className="max-w-[380px] px-4 py-3 text-xs text-muted-foreground">
                    <p className="line-clamp-2">{entry.body}</p>
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-xs text-red-700 dark:text-red-400">
                    {entry.error ?? 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DefaultLandingPagePreference() {
  const [value, setValue] = useState('/');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await api.get<{ defaultLandingPage?: string }>('/api/settings/preferences');
        if (!active) return;
        const route = data.defaultLandingPage || '/';
        const isValid = LANDING_PAGE_OPTIONS.some((option) => option.value === route);
        setValue(isValid ? route : '/');
      } catch {
        if (!active) return;
        setValue('/');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const savePreference = async () => {
    setSaving(true);
    try {
      await api.patch('/api/settings/preferences', { defaultLandingPage: value });
      toast.success('Default landing page updated');
    } catch (err) {
      toast.error(`Failed to save default landing page: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="h-5 w-5" />
        <h2 className="text-lg font-semibold">General</h2>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="default-landing-page" className="text-sm font-medium">
          Default Landing Page
        </label>
        <div className="flex items-center gap-3">
          <ThemedSelect
            id="default-landing-page"
            value={value}
            disabled={loading || saving}
            onValueChange={(val) => setValue(val)}
            options={LANDING_PAGE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <button
            onClick={savePreference}
            disabled={loading || saving}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
        <p className="text-sm text-muted-foreground">Page shown after login. Fallback is Home if route becomes invalid.</p>
      </div>
    </div>
  );
}

function PortainerBackupManagement() {
  const { data, isLoading, refetch } = usePortainerBackups();
  const createBackup = useCreatePortainerBackup();
  const deleteBackupMut = useDeletePortainerBackup();
  const [manualPassword, setManualPassword] = useState('');
  const [showManualPassword, setShowManualPassword] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const backups = data?.backups ?? [];

  const handleCreate = () => {
    createBackup.mutate(manualPassword || undefined, {
      onSuccess: (result) => {
        toast.success(`Portainer backup created: ${result.filename}`);
        setManualPassword('');
      },
      onError: (err) => {
        toast.error(`Backup failed: ${err.message}`);
      },
    });
  };

  const handleDownload = async (filename: string) => {
    try {
      await downloadPortainerBackup(filename);
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDelete = (filename: string) => {
    setDeletingFile(filename);
    deleteBackupMut.mutate(filename, {
      onSuccess: () => {
        toast.success(`Deleted ${filename}`);
        setDeletingFile(null);
      },
      onError: (err) => {
        toast.error(`Delete failed: ${err.message}`);
        setDeletingFile(null);
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Manual Backup */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Create Backup</h2>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Create a manual backup of your Portainer server configuration. This calls the Portainer API and saves the resulting archive locally.
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-sm">
              <label htmlFor="manual-backup-password" className="text-sm font-medium mb-1 block">
                Password (optional)
              </label>
              <div className="relative">
                <input
                  id="manual-backup-password"
                  type={showManualPassword ? 'text' : 'password'}
                  value={manualPassword}
                  onChange={(e) => setManualPassword(e.target.value)}
                  placeholder="Encryption password"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowManualPassword(!showManualPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showManualPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button
              onClick={handleCreate}
              disabled={createBackup.isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createBackup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HardDriveDownload className="h-4 w-4" />
              )}
              Create Backup
            </button>
          </div>
        </div>
      </div>

      {/* Backup List */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Backup Files</h2>
            <span className="text-sm text-muted-foreground">({backups.length})</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        ) : backups.length === 0 ? (
          <div className="p-8 text-center">
            <Archive className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm font-medium">No Portainer backups yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a manual backup above or enable scheduled backups.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Filename</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.filename} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{backup.filename}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatBytes(backup.size)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownload(backup.filename)}
                          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                        <button
                          onClick={() => handleDelete(backup.filename)}
                          disabled={deletingFile === backup.filename}
                          className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingFile === backup.filename ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme, toggleThemes, setToggleThemes, dashboardBackground, setDashboardBackground } = useThemeStore();
  const { data: settingsData, isLoading, isError, error, refetch } = useSettings();
  const updateSetting = useUpdateSetting();
  const { data: cacheStats } = useCacheStats();
  const cacheClear = useCacheClear();
  const redisSystemInfo = getRedisSystemInfo(cacheStats);

  // Local state for edited values
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  type SettingsTab = 'general' | 'portainer-backup' | 'users' | 'webhooks';
  const validTabs: SettingsTab[] = ['general', 'portainer-backup', 'users', 'webhooks'];
  const initialTab = validTabs.includes(searchParams.get('tab') as SettingsTab)
    ? (searchParams.get('tab') as SettingsTab)
    : 'general';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    const raw = searchParams.get('tab');
    const requestedTab: SettingsTab = validTabs.includes(raw as SettingsTab)
      ? (raw as SettingsTab)
      : 'general';
    setActiveTab((currentTab) =>
      currentTab === requestedTab ? currentTab : requestedTab
    );
  }, [searchParams]);

  // Initialize values from API data
  useEffect(() => {
    if (settingsData) {
      // Handle both array and object responses
      const settingsArray = Array.isArray(settingsData)
        ? settingsData
        : (settingsData as { settings?: unknown[] }).settings || [];

      const values: Record<string, string> = {};
      (settingsArray as Array<{ key: string; value: string }>).forEach((s) => {
        values[s.key] = s.value;
      });

      // Fill in defaults for missing settings
      Object.values(DEFAULT_SETTINGS).flat().forEach((setting) => {
        if (!(setting.key in values)) {
          values[setting.key] = setting.defaultValue;
        }
      });

      setEditedValues(values);
      setOriginalValues(values);
    }
  }, [settingsData]);

  // Calculate if there are changes
  const hasChanges = useMemo(() => {
    return Object.keys(editedValues).some(
      (key) => editedValues[key] !== originalValues[key]
    );
  }, [editedValues, originalValues]);

  // Get changed settings that require restart
  const changesRequireRestart = useMemo(() => {
    const restartKeys = [
      'monitoring.polling_interval',
      'monitoring.enabled',
      'llm.ollama_url',
      'llm.model',
      'llm.custom_endpoint_enabled',
      'llm.custom_endpoint_url',
      'llm.custom_endpoint_token',
      'elasticsearch.enabled',
      'elasticsearch.endpoint',
      'elasticsearch.api_key',
      'oidc.enabled',
      'oidc.issuer_url',
      'oidc.client_id',
      'oidc.client_secret',
      'notifications.teams_enabled',
      'notifications.teams_webhook_url',
      'notifications.email_enabled',
      'notifications.smtp_host',
      'notifications.smtp_port',
      'notifications.smtp_user',
      'notifications.smtp_password',
      'notifications.email_recipients',
      'webhooks.enabled',
      'portainer_backup.enabled',
      'portainer_backup.interval_hours',
    ];
    return restartKeys.some(
      (key) => editedValues[key] !== originalValues[key]
    );
  }, [editedValues, originalValues]);

  // Handle value change
  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  // Handle save
  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      // Find all changed settings
      const changedKeys = Object.keys(editedValues).filter(
        (key) => editedValues[key] !== originalValues[key]
      );

      // Update each changed setting
      for (const key of changedKeys) {
        await updateSetting.mutateAsync({
          key,
          value: editedValues[key],
        });
      }

      // Update original values to match edited
      setOriginalValues({ ...editedValues });
      setSaveSuccess(true);

      if (changesRequireRestart) {
        toast.info('Some changes require a service restart to take effect');
      }
    } catch (err) {
      toast.error('Failed to save some settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle reset
  const handleReset = () => {
    setEditedValues({ ...originalValues });
    setSaveSuccess(false);
  };

  const handleTabChange = (tab: string) => {
    if (!validTabs.includes(tab as SettingsTab)) return;

    setActiveTab(tab as SettingsTab);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (tab === 'general') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    }, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
        <div className="grid gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Environment, backup, monitoring, and cache configuration
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="font-semibold">Failed to load settings</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Unknown error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Environment, backup, monitoring, and cache configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </div>
          )}
          {hasChanges && (
            <>
              <button
                onClick={handleReset}
                disabled={isSaving}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>

      {/* Restart Warning */}
      {changesRequireRestart && hasChanges && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-500">Restart Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Some of the changes you've made require a service restart to take effect.
              After saving, restart the backend service to apply these changes.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <Tabs.List className="flex items-center gap-1 border-b">
          <Tabs.Trigger
            value="general"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <Settings2 className="h-4 w-4" />
            General
          </Tabs.Trigger>
          <Tabs.Trigger
            value="portainer-backup"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <HardDriveDownload className="h-4 w-4" />
            Portainer Backup
          </Tabs.Trigger>
          <Tabs.Trigger
            value="users"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <Users className="h-4 w-4" />
            Users
          </Tabs.Trigger>
          <Tabs.Trigger
            value="webhooks"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <Webhook className="h-4 w-4" />
            Webhooks
          </Tabs.Trigger>
        </Tabs.List>

        {/* General Tab */}
        <Tabs.Content value="general" className="space-y-6 focus:outline-none">

      {/* Theme Settings */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Appearance</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Choose your preferred color theme for the dashboard.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                'flex items-center gap-3 p-4 rounded-lg border text-left transition-colors',
                theme === option.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-center w-10 h-10 rounded-lg',
                  theme === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <ThemeIcon theme={option.value} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{option.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {option.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Header Toggle</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose the two themes the header pill switch toggles between.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Light side (Sun)</label>
              <ThemedSelect
                value={toggleThemes[0]}
                onValueChange={(v) => setToggleThemes([v as Theme, toggleThemes[1]])}
                options={themeOptions.filter((o) => o.value !== 'system').map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Dark side (Moon)</label>
              <ThemedSelect
                value={toggleThemes[1]}
                onValueChange={(v) => setToggleThemes([toggleThemes[0], v as Theme])}
                options={themeOptions.filter((o) => o.value !== 'system').map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Dashboard Background</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Add an animated gradient background to the dashboard, similar to the login page.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {dashboardBackgroundOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setDashboardBackground(option.value)}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                  dashboardBackground === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{option.label}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <DefaultLandingPagePreference />

      {/* Authentication Settings */}
      <SettingsSection
        title="Authentication"
        icon={<Shield className="h-5 w-5" />}
        category="authentication"
        settings={DEFAULT_SETTINGS.authentication}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
        disabled={isSaving}
      />

      {/* Monitoring Settings */}
      <SettingsSection
        title="Monitoring"
        icon={<Activity className="h-5 w-5" />}
        category="monitoring"
        settings={DEFAULT_SETTINGS.monitoring}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
        disabled={isSaving}
      />

      {/* Anomaly Detection Settings */}
      <SettingsSection
        title="Anomaly Detection"
        icon={<AlertTriangle className="h-5 w-5" />}
        category="anomaly"
        settings={DEFAULT_SETTINGS.anomaly}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        disabled={isSaving}
      />

      {/* Notification Settings */}
      <SettingsSection
        title="Notifications"
        icon={<Bell className="h-5 w-5" />}
        category="notifications"
        settings={DEFAULT_SETTINGS.notifications}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
        disabled={isSaving}
      />

      {/* Notification Test Buttons */}
      <NotificationTestButtons />

      {/* Notification History */}
      <NotificationHistoryPanel />

      {/* Webhooks Settings */}
      <SettingsSection
        title="Webhooks"
        icon={<Webhook className="h-5 w-5" />}
        category="webhooks"
        settings={DEFAULT_SETTINGS.webhooks}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
        disabled={isSaving}
      />

      {/* Cache Settings */}
      <SettingsSection
        title="Cache"
        icon={<Database className="h-5 w-5" />}
        category="cache"
        settings={DEFAULT_SETTINGS.cache}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        disabled={isSaving}
      />

      {/* Cache Status */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Cache Status</h2>
          </div>
          <button
            onClick={() => cacheClear.mutate()}
            disabled={cacheClear.isPending}
            className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {cacheClear.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Clear All Cache
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Entries</p>
              <p className="text-2xl font-bold mt-1">{cacheStats?.size ?? 0}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Hits</p>
              <p className="text-2xl font-bold mt-1">{cacheStats?.hits ?? 0}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Misses</p>
              <p className="text-2xl font-bold mt-1">{cacheStats?.misses ?? 0}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Hit Rate</p>
              <p className="text-2xl font-bold mt-1">{cacheStats?.hitRate ?? 'N/A'}</p>
            </div>
          </div>
          {cacheStats?.entries && cacheStats.entries.length > 0 && (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Cache Key</th>
                    <th className="text-right p-3 font-medium">Expires In</th>
                  </tr>
                </thead>
                <tbody>
                  {cacheStats.entries.map((entry) => (
                    <tr key={entry.key} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">{entry.key}</td>
                      <td className="p-3 text-right text-muted-foreground">{entry.expiresIn}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* LLM Settings */}
      <LlmSettingsSection
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        disabled={isSaving}
      />

      {/* Status Page Settings */}
      <SettingsSection
        title="Public Status Page"
        icon={<Globe className="h-5 w-5" />}
        category="statusPage"
        settings={DEFAULT_SETTINGS.statusPage}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        disabled={isSaving}
      />

      {/* Elasticsearch Settings */}
      <SettingsSection
        title="Elasticsearch / Kibana"
        icon={<Search className="h-5 w-5" />}
        category="elasticsearch"
        settings={DEFAULT_SETTINGS.elasticsearch}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
        disabled={isSaving}
      />

      {/* System Info */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">System Information</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Application</p>
            <p className="font-medium mt-1">Docker Insight</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Version</p>
            <p className="font-medium mt-1">1.0.0</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Mode</p>
            <p className="font-medium mt-1">Observer Only</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Theme</p>
            <p className="font-medium mt-1 capitalize">{theme.replace('-', ' ')}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Redis Cache</p>
            <p className="font-medium mt-1">{redisSystemInfo.status}</p>
            <p className="text-xs text-muted-foreground mt-1">{redisSystemInfo.details}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Redis Keys</p>
            <p className="font-medium mt-1">{redisSystemInfo.keys}</p>
          </div>
        </div>
      </div>

        </Tabs.Content>

        {/* Portainer Backup Tab */}
        <Tabs.Content value="portainer-backup" className="space-y-6 focus:outline-none">

      {/* Backup Schedule Settings */}
      <SettingsSection
        title="Backup Schedule"
        icon={<Clock className="h-5 w-5" />}
        category="portainerBackup"
        settings={DEFAULT_SETTINGS.portainerBackup}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
        disabled={isSaving}
      />

      {/* Backup Management */}
      <PortainerBackupManagement />

        </Tabs.Content>

        {/* Users Tab */}
        <Tabs.Content value="users" className="space-y-6 focus:outline-none">
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
            <LazyUsersPanel />
          </Suspense>
        </Tabs.Content>

        {/* Webhooks Tab */}
        <Tabs.Content value="webhooks" className="space-y-6 focus:outline-none">
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
            <LazyWebhooksPanel />
          </Suspense>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
