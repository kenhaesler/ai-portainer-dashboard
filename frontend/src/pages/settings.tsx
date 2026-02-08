import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
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
  Plug,
  Plus,
  Power,
  PowerOff,
  Wrench,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  MessageSquare,
  Save,
  Play,
  X,
  FileText,
  Zap,
  Copy,
  Layers,
  Upload,
  ThumbsUp,
} from 'lucide-react';
import {
  useThemeStore,
  themeOptions,
  dashboardBackgroundOptions,
  iconThemeOptions,
  DEFAULT_THEME,
  DEFAULT_DASHBOARD_BACKGROUND,
  DEFAULT_TOGGLE_THEMES,
  DEFAULT_ICON_THEME,
  DEFAULT_FAVICON_ICON,
  DEFAULT_SIDEBAR_ICON,
  DEFAULT_LOGIN_ICON,
  type Theme,
  type DashboardBackground,
  type IconTheme,
} from '@/stores/theme-store';
import { ICON_SETS, ICON_SET_MAP, type AppIconId } from '@/components/icons/icon-sets';
import { useSettings, useUpdateSetting } from '@/hooks/use-settings';
import {
  usePromptProfiles,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile,
  useDuplicateProfile,
  useSwitchProfile,
  useExportProfile,
  useImportPreview,
  useImportApply,
  type PromptProfile,
  type PromptProfileFeatureConfig,
  type PromptExportData,
  type ImportPreviewResponse,
} from '@/hooks/use-prompt-profiles';
import { useCacheStats, useCacheClear } from '@/hooks/use-cache-admin';
import { useLlmModels, useLlmTestConnection, useLlmTestPrompt } from '@/hooks/use-llm-models';
import { useSecurityIgnoreList, useUpdateSecurityIgnoreList } from '@/hooks/use-security-audit';
import type { LlmModel, LlmTestPromptResponse } from '@/hooks/use-llm-models';
import {
  usePortainerBackups,
  useCreatePortainerBackup,
  useDeletePortainerBackup,
  downloadPortainerBackup,
} from '@/hooks/use-portainer-backups';
import {
  useMcpServers,
  useCreateMcpServer,
  useDeleteMcpServer,
  useConnectMcpServer,
  useDisconnectMcpServer,
  useMcpServerTools,
  type McpServer,
} from '@/hooks/use-mcp';
import { useAuth } from '@/providers/auth-provider';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { ThemedSelect } from '@/components/shared/themed-select';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

const LazyUsersPanel = lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPanel })));
const LazyWebhooksPanel = lazy(() => import('@/pages/webhooks').then((m) => ({ default: m.WebhooksPanel })));
const LazyAiFeedbackPanel = lazy(() => import('@/pages/settings-ai-feedback').then((m) => ({ default: m.AiFeedbackPanel })));
const REDACTED_SECRET = '••••••••';

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
    { key: 'llm.max_tokens', label: 'Max Tokens', description: 'Maximum tokens in LLM response', type: 'number', defaultValue: '20000', min: 256, max: 128000 },
    { key: 'llm.custom_endpoint_enabled', label: 'Custom Endpoint Enabled', description: 'Use a custom OpenAI-compatible API endpoint', type: 'boolean', defaultValue: 'false' },
    { key: 'llm.custom_endpoint_url', label: 'Custom Endpoint URL', description: 'OpenAI-compatible chat completions URL', type: 'string', defaultValue: '' },
    { key: 'llm.custom_endpoint_token', label: 'Custom Endpoint Token', description: 'Bearer token for custom endpoint', type: 'password', defaultValue: '' },
  ],
  authentication: [
    { key: 'oidc.enabled', label: 'Enable OIDC/SSO', description: 'Enable OpenID Connect single sign-on authentication', type: 'boolean', defaultValue: 'false' },
    { key: 'oidc.issuer_url', label: 'Issuer URL', description: 'OIDC provider issuer URL (e.g., https://auth.example.com/realms/master)', type: 'string', defaultValue: '' },
    { key: 'oidc.client_id', label: 'Client ID', description: 'OIDC client identifier registered with your provider', type: 'string', defaultValue: '' },
    { key: 'oidc.client_secret', label: 'Client Secret', description: 'OIDC client secret for server-side authentication', type: 'password', defaultValue: '' },
    { key: 'oidc.redirect_uri', label: 'Redirect URI', description: 'Callback URL (e.g., http://localhost:5273/auth/callback)', type: 'string', defaultValue: '' },
    { key: 'oidc.scopes', label: 'Scopes', description: 'Space-separated OIDC scopes to request', type: 'string', defaultValue: 'openid profile email' },
    { key: 'oidc.local_auth_enabled', label: 'Keep Local Auth Enabled', description: 'Allow username/password login alongside SSO', type: 'boolean', defaultValue: 'true' },
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
} as const;

type SettingCategory = keyof typeof DEFAULT_SETTINGS;
const SETTING_CATEGORY_BY_KEY: Record<string, SettingCategory> = Object.entries(DEFAULT_SETTINGS).reduce(
  (acc, [category, settings]) => {
    settings.forEach((setting) => {
      acc[setting.key] = category as SettingCategory;
    });
    return acc;
  },
  {} as Record<string, SettingCategory>,
);

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
  if (theme === 'apple-light' || theme === 'nordic-frost' || theme === 'sandstone-dusk') return <Sun className="h-4 w-4" />;
  if (theme === 'apple-dark') return <Sparkles className="h-4 w-4" />;
  if (theme === 'hyperpop-chaos') return <Sparkles className="h-4 w-4" />;
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

// ─── MCP Servers Section ────────────────────────────────────────────

function McpServerRow({ server }: { server: McpServer }) {
  const connectMutation = useConnectMcpServer();
  const disconnectMutation = useDisconnectMcpServer();
  const deleteMutation = useDeleteMcpServer();
  const [showTools, setShowTools] = useState(false);
  const toolsQuery = useMcpServerTools(server.id, showTools && server.connected);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${server.connected ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          <div>
            <div className="font-medium text-sm">{server.name}</div>
            <div className="text-xs text-muted-foreground">
              {server.transport} {server.transport === 'stdio' ? `· ${server.command}` : `· ${server.url}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {server.connected && (
            <button
              onClick={() => setShowTools(!showTools)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Show tools"
            >
              <Wrench className="h-4 w-4" />
            </button>
          )}
          {server.connected ? (
            <button
              onClick={() => disconnectMutation.mutate(server.id)}
              disabled={disconnectMutation.isPending}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Disconnect"
            >
              <PowerOff className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => connectMutation.mutate(server.id)}
              disabled={connectMutation.isPending}
              className="p-1.5 rounded-md hover:bg-accent text-emerald-500 hover:text-emerald-400 transition-colors"
              title="Connect"
            >
              <Power className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => { if (confirm(`Delete MCP server "${server.name}"?`)) deleteMutation.mutate(server.id); }}
            disabled={deleteMutation.isPending}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {server.connectionError && (
        <p className="text-xs text-red-400">{server.connectionError}</p>
      )}
      {server.connected && (
        <span className="text-xs text-muted-foreground">{server.toolCount} tools available</span>
      )}
      {showTools && toolsQuery.data && (
        <div className="border-t border-border pt-2 space-y-1">
          {toolsQuery.data.tools.map(tool => (
            <div key={tool.name} className="text-xs py-1 px-2 rounded bg-muted/50">
              <span className="font-mono font-medium">{tool.name}</span>
              {tool.description && <span className="text-muted-foreground ml-2">— {tool.description}</span>}
            </div>
          ))}
          {toolsQuery.data.tools.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No tools exposed by this server</p>
          )}
        </div>
      )}
    </div>
  );
}

function McpServersSection() {
  const { data: servers, isLoading } = useMcpServers();
  const createMutation = useCreateMcpServer();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'sse' | 'http',
    command: '',
    url: '',
  });

  const handleAdd = () => {
    const body: Record<string, string> = { name: formData.name, transport: formData.transport };
    if (formData.transport === 'stdio') body.command = formData.command;
    else body.url = formData.url;
    createMutation.mutate(body as any, {
      onSuccess: () => {
        setFormData({ name: '', transport: 'stdio', command: '', url: '' });
        setShowForm(false);
      },
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Plug className="h-5 w-5 text-purple-500" />
          <div>
            <h3 className="font-semibold text-base">MCP Servers</h3>
            <p className="text-xs text-muted-foreground">Connect external tool servers for the AI assistant</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add Server
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
              <input
                value={formData.name}
                onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="my-mcp-server"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Transport</label>
              <select
                value={formData.transport}
                onChange={e => setFormData(p => ({ ...p, transport: e.target.value as any }))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              >
                <option value="stdio">stdio (local command)</option>
                <option value="sse">SSE (remote)</option>
                <option value="http">HTTP (streamable)</option>
              </select>
            </div>
          </div>
          {formData.transport === 'stdio' ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Command</label>
              <input
                value={formData.command}
                onChange={e => setFormData(p => ({ ...p, command: e.target.value }))}
                placeholder="npx -y @modelcontextprotocol/server-filesystem /data"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">URL</label>
              <input
                value={formData.url}
                onChange={e => setFormData(p => ({ ...p, url: e.target.value }))}
                placeholder="http://mcp-server:3000/sse"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!formData.name || createMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Server'}
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-400">{createMutation.error.message}</p>
          )}
        </div>
      )}

      {isLoading && <div className="text-sm text-muted-foreground">Loading servers...</div>}
      {servers && servers.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground text-center py-4">No MCP servers configured yet</p>
      )}
      {servers?.map(server => (
        <McpServerRow key={server.id} server={server} />
      ))}
    </div>
  );
}

interface LlmSettingsSectionProps {
  values: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

interface LogsConfigResponse {
  configured: boolean;
  endpoint: string | null;
  indexPattern: string | null;
}

interface TestConnectionResponse {
  success: boolean;
  error?: string;
  status?: string;
  cluster_name?: string;
  number_of_nodes?: number;
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
  const llmConfigured = Boolean(selectedModel.trim()) && (customEnabled ? Boolean(customUrl.trim()) : Boolean(ollamaUrl.trim()));

  const handleScanModels = () => {
    void queryClient.invalidateQueries({ queryKey: ['llm-models', ollamaUrl] });
    void refetchModels();
  };

  const handleTestConnection = () => {
    if (customEnabled && !customUrl.trim()) {
      setConnectionStatus('error');
      setConnectionError('Custom endpoint URL is required when custom mode is enabled.');
      toast.error('Set a custom endpoint URL before testing connection');
      return;
    }

    const body = customEnabled && customUrl.trim()
      ? { url: customUrl.trim(), token: customToken }
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
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
            llmConfigured
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          )}>
            {llmConfigured ? 'Configured' : 'Not configured'}
          </span>
          {hasChanges && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
              <RefreshCw className="h-3 w-3" />
              Requires restart
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-6">
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
            <p className="text-xs text-muted-foreground mt-1">
              Lower values are more deterministic and consistent. Higher values are more varied and creative.
            </p>
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
              max={128000}
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

        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
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
          {connectionStatus === 'ok' && testConnection.data?.models && testConnection.data.models.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {testConnection.data.models.length} model{testConnection.data.models.length !== 1 ? 's' : ''} available on server
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ElasticsearchSettingsSectionProps {
  values: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

export function ElasticsearchSettingsSection({
  values,
  originalValues,
  onChange,
  disabled,
}: ElasticsearchSettingsSectionProps) {
  const [configStatus, setConfigStatus] = useState<LogsConfigResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const enabled = values['elasticsearch.enabled'] === 'true';
  const endpoint = values['elasticsearch.endpoint'] ?? '';
  const apiKey = values['elasticsearch.api_key'] ?? '';
  const indexPattern = values['elasticsearch.index_pattern'] ?? 'logs-*';
  const verifySsl = values['elasticsearch.verify_ssl'] !== 'false';

  const hasChanges = [
    'elasticsearch.enabled',
    'elasticsearch.endpoint',
    'elasticsearch.api_key',
    'elasticsearch.index_pattern',
    'elasticsearch.verify_ssl',
  ].some((key) => values[key] !== originalValues[key]);

  const endpointValidationError = useMemo(() => {
    if (!endpoint.trim()) return 'Endpoint is required.';
    try {
      const parsed = new URL(endpoint);
      if (!/^https?:$/.test(parsed.protocol)) {
        return 'Endpoint must start with http:// or https://';
      }
      return null;
    } catch {
      return 'Enter a valid URL (for example: https://logs.internal:9200)';
    }
  }, [endpoint]);

  useEffect(() => {
    let active = true;
    const loadConfigStatus = async () => {
      setIsLoadingStatus(true);
      try {
        const config = await api.get<LogsConfigResponse>('/api/logs/config');
        if (!active) return;
        setConfigStatus(config);
      } catch {
        if (!active) return;
        setConfigStatus(null);
      } finally {
        if (active) {
          setIsLoadingStatus(false);
        }
      }
    };

    void loadConfigStatus();
    return () => {
      active = false;
    };
  }, []);

  const handleTestConnection = async () => {
    if (endpointValidationError) return;

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<TestConnectionResponse>('/api/logs/test-connection', {
        endpoint: endpoint.trim(),
        apiKey: apiKey.trim() && apiKey !== REDACTED_SECRET ? apiKey.trim() : undefined,
        verifySsl,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Elasticsearch / Kibana</h2>
        </div>
        <div className="flex items-center gap-2">
          {configStatus && (
            <span className={cn(
              'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
              configStatus.configured
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
            )}>
              {configStatus.configured ? 'Configured' : 'Not configured'}
            </span>
          )}
          {hasChanges && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
              Modified
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Configure Elasticsearch in Settings. When enabled, the backend forwards container-origin logs to the configured cluster.
        </p>

        <div className="flex items-center justify-between py-2">
          <div>
            <label className="font-medium">Enable Elasticsearch logs</label>
            <p className="text-sm text-muted-foreground mt-0.5">Enable forwarding and search integration.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange('elasticsearch.enabled', enabled ? 'false' : 'true')}
            disabled={disabled}
            aria-label="Toggle Elasticsearch logs"
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              enabled ? 'bg-primary' : 'bg-muted',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                enabled ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Elasticsearch Endpoint</span>
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3"
              value={endpoint}
              onChange={(e) => onChange('elasticsearch.endpoint', e.target.value)}
              placeholder="https://logs.internal:9200"
              disabled={disabled}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Index Pattern</span>
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3"
              value={indexPattern}
              onChange={(e) => onChange('elasticsearch.index_pattern', e.target.value)}
              placeholder="logs-*"
              disabled={disabled}
            />
          </label>

          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block text-muted-foreground">API Key (optional)</span>
            <div className="relative">
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10"
                value={apiKey}
                onChange={(e) => onChange('elasticsearch.api_key', e.target.value)}
                type={showApiKey ? 'text' : 'password'}
                placeholder="Api key"
                disabled={disabled}
              />
              <button
                type="button"
                onClick={() => setShowApiKey((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={verifySsl}
            onChange={(e) => onChange('elasticsearch.verify_ssl', String(e.target.checked))}
            disabled={disabled}
          />
          Verify SSL
        </label>

        {endpointValidationError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{endpointValidationError}</p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={disabled || isTesting || !!endpointValidationError}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            Test Connection
          </button>
          {isLoadingStatus && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking status...
            </span>
          )}
        </div>

        {testResult && (
          <div className={cn(
            'rounded-md border p-3 text-sm',
            testResult.success
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300'
              : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'
          )}>
            <div className="flex items-center gap-1">
              {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <span className="font-medium">{testResult.success ? 'Connection successful' : 'Connection failed'}</span>
            </div>
            {!testResult.success && testResult.error && (
              <p className="mt-1 text-xs">{testResult.error}</p>
            )}
            {testResult.success && (
              <p className="mt-1 text-xs">
                Cluster: {testResult.cluster_name ?? 'unknown'} | Status: {testResult.status ?? 'unknown'} | Nodes: {testResult.number_of_nodes ?? 'n/a'}
              </p>
            )}
          </div>
        )}
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

export function SecurityAuditSettingsSection() {
  const { data, isLoading, isError, error, refetch } = useSecurityIgnoreList();
  const updateIgnoreList = useUpdateSecurityIgnoreList();
  const [draftValue, setDraftValue] = useState('');
  const [lastSavedValue, setLastSavedValue] = useState('');
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasPatternsConfigured = (data?.patterns.length ?? 0) > 0;

  useEffect(() => {
    if (!data) return;
    const initialValue = data.patterns.join('\n');
    setDraftValue(initialValue);
    setLastSavedValue(initialValue);
  }, [data]);

  const parsePatterns = (): string[] => {
    return draftValue
      .split('\n')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  };

  const handleReset = () => {
    if (!data?.defaults) return;
    setDraftValue(data.defaults.join('\n'));
  };

  useEffect(() => {
    if (!data || isLoading || isError) return;
    if (draftValue === lastSavedValue) return;

    const timeout = window.setTimeout(() => {
      setIsAutoSaving(true);
      void updateIgnoreList.mutateAsync(parsePatterns())
        .then(() => {
          setLastSavedValue(draftValue);
          toast.success('Security ignore list updated');
        })
        .catch((err) => {
          toast.error(`Failed to save ignore list: ${err instanceof Error ? err.message : 'Unknown error'}`);
        })
        .finally(() => {
          setIsAutoSaving(false);
        });
    }, 600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [data, draftValue, isError, isLoading, lastSavedValue, updateIgnoreList]);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Security Audit Ignore List</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
            hasPatternsConfigured
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          )}>
            {hasPatternsConfigured ? 'Configured' : 'Not configured'}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading || !data?.defaults}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Reset Defaults
          </button>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          One container name pattern per line. Use <code>*</code> as a wildcard (for example <code>nginx*</code>).
          Ignored containers remain visible in the audit and are marked as ignored.
        </p>
        <p className="text-xs text-muted-foreground">
          {isAutoSaving || updateIgnoreList.isPending ? 'Saving changes...' : 'All changes saved automatically'}
        </p>

        {isError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Failed to load ignore list: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        ) : (
          <textarea
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            className="min-h-[160px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            placeholder="portainer\ntraefik\nnginx*"
            disabled={isLoading || updateIgnoreList.isPending}
          />
        )}
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

// ─── AI Prompts Settings Tab ────────────────────────────────────────

interface PromptFeatureInfo {
  key: string;
  label: string;
  description: string;
  defaultPrompt: string;
}

// ─── Profile Selector ──────────────────────────────────────────────

function ProfileSelector({
  onProfileSwitch,
  onImportPreview,
}: {
  onProfileSwitch: () => void;
  onImportPreview: (data: PromptExportData, preview: ImportPreviewResponse) => void;
}) {
  const { data: profileData, isLoading } = usePromptProfiles();
  const createProfile = useCreateProfile();
  const deleteProfileMut = useDeleteProfile();
  const duplicateProfile = useDuplicateProfile();
  const switchProfileMut = useSwitchProfile();
  const exportProfile = useExportProfile();
  const importPreview = useImportPreview();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    exportProfile.mutate({ profileId: activeId });
  };

  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    if (file.size > 1024 * 1024) {
      setImportError('File too large (max 1 MB)');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PromptExportData;
      if (typeof parsed.version !== 'number' || typeof parsed.features !== 'object') {
        setImportError('Invalid file format: missing required fields');
        return;
      }
      const preview = await importPreview.mutateAsync(parsed);
      setImportError(null);
      onImportPreview(parsed, preview);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setImportError('Invalid JSON file');
      } else {
        setImportError(err instanceof Error ? err.message : 'Failed to parse import file');
      }
    }
  };

  const profiles = profileData?.profiles ?? [];
  const activeId = profileData?.activeProfileId ?? 'default';
  const activeProfile = profiles.find((p) => p.id === activeId);

  const handleSwitch = async (id: string) => {
    if (id === activeId) return;
    await switchProfileMut.mutateAsync({ id });
    onProfileSwitch();
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createProfile.mutateAsync({
      name: newName.trim(),
      description: newDescription.trim(),
      prompts: {},
    });
    setNewName('');
    setNewDescription('');
    setShowNewDialog(false);
  };

  const handleDuplicate = async () => {
    if (!newName.trim() || !activeProfile) return;
    await duplicateProfile.mutateAsync({
      sourceId: activeId,
      name: newName.trim(),
    });
    setNewName('');
    setShowDuplicateDialog(false);
  };

  const handleDelete = async () => {
    if (!activeProfile || activeProfile.isBuiltIn) return;
    await deleteProfileMut.mutateAsync({ id: activeId, name: activeProfile.name });
    setShowDeleteConfirm(false);
    onProfileSwitch();
  };

  if (isLoading) {
    return <div className="h-10 animate-pulse rounded bg-muted" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Active Profile:</span>
        </div>

        <ThemedSelect
          value={activeId}
          onValueChange={(val) => void handleSwitch(val)}
          options={profiles.map((p) => ({
            value: p.id,
            label: `${p.name}${p.isBuiltIn ? ' (built-in)' : ''}`,
          }))}
          className="min-w-[200px]"
        />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setNewName(''); setNewDescription(''); setShowNewDialog(true); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
          <button
            type="button"
            onClick={() => { setNewName(`${activeProfile?.name ?? 'Profile'} (Copy)`); setShowDuplicateDialog(true); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          {activeProfile && !activeProfile.isBuiltIn && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1 text-sm text-red-600 hover:text-red-500 border border-red-200 dark:border-red-900 rounded-md px-2.5 py-1.5 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}

          <span className="text-muted-foreground">|</span>

          <button
            type="button"
            onClick={handleExport}
            disabled={exportProfile.isPending}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exportProfile.isPending ? 'Exporting...' : 'Export'}
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importPreview.isPending}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {importPreview.isPending ? 'Reading...' : 'Import'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />
        </div>
      </div>

      {importError && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-500/5 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {activeProfile && (
        <p className="text-xs text-muted-foreground pl-6">
          {activeProfile.description || 'No description'}
        </p>
      )}

      {/* New Profile Dialog */}
      {showNewDialog && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Create New Profile</h4>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Custom Profile"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Description</label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Brief description of this profile's focus"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewDialog(false)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newName.trim() || createProfile.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createProfile.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Dialog */}
      {showDuplicateDialog && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Duplicate "{activeProfile?.name}"</h4>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">New Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Profile name"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDuplicateDialog(false)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDuplicate()}
              disabled={!newName.trim() || duplicateProfile.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {duplicateProfile.isPending ? 'Duplicating...' : 'Duplicate'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && activeProfile && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-500/5 p-4 space-y-3">
          <p className="text-sm">
            Are you sure you want to delete "<strong>{activeProfile.name}</strong>"? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleteProfileMut.isPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteProfileMut.isPending ? 'Deleting...' : 'Delete Profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function TokenBadge({ count }: { count: number }) {
  const color = count < 500 ? 'text-emerald-600 bg-emerald-500/10' : count < 1000 ? 'text-amber-600 bg-amber-500/10' : 'text-red-600 bg-red-500/10';
  return (
    <span className={cn('text-xs px-1.5 py-0.5 rounded font-mono', color)}>
      ~{count} tokens
    </span>
  );
}

function PromptTestPanel({
  feature,
  systemPrompt,
  model,
  temperature,
}: {
  feature: string;
  systemPrompt: string;
  model: string;
  temperature: string;
}) {
  const testPrompt = useLlmTestPrompt();
  const [result, setResult] = useState<LlmTestPromptResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleTest = () => {
    setIsOpen(true);
    setResult(null);
    testPrompt.mutate(
      {
        feature,
        systemPrompt,
        ...(model ? { model } : {}),
        ...(temperature ? { temperature: parseFloat(temperature) } : {}),
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (err) => setResult({ success: false, error: err.message }),
      },
    );
  };

  const handleCancel = () => {
    setIsOpen(false);
    setResult(null);
  };

  const isLoading = testPrompt.isPending;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleTest}
        disabled={isLoading}
        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {isLoading ? 'Testing...' : 'Test Prompt'}
      </button>

      {isOpen && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Test Results
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Sample Input Preview */}
          {result?.sampleInput && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Sample input: {result.sampleLabel}
              </p>
              <pre className="text-xs bg-background rounded border border-border p-2 overflow-x-auto max-h-24 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                {result.sampleInput.length > 300
                  ? result.sampleInput.slice(0, 300) + '...'
                  : result.sampleInput}
              </pre>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Waiting for LLM response...</span>
            </div>
          )}

          {/* Error State */}
          {result && !result.success && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-sm text-red-600 dark:text-red-400">
                {result.error || 'Unknown error'}
              </p>
              {result.latencyMs !== undefined && (
                <p className="text-xs text-muted-foreground mt-1">
                  Failed after {(result.latencyMs / 1000).toFixed(1)}s
                </p>
              )}
            </div>
          )}

          {/* Success State */}
          {result?.success && (
            <>
              <div>
                <p className="text-xs text-muted-foreground mb-1">LLM Response:</p>
                <pre className="text-sm bg-background rounded border border-border p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                  {result.format === 'json'
                    ? (() => {
                        try {
                          return JSON.stringify(JSON.parse(result.response!), null, 2);
                        } catch {
                          return result.response;
                        }
                      })()
                    : result.response}
                </pre>
              </div>

              {/* Stats Bar */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-2">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {result.latencyMs !== undefined
                    ? result.latencyMs < 1000
                      ? `${result.latencyMs}ms`
                      : `${(result.latencyMs / 1000).toFixed(1)}s`
                    : '-'}
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {result.tokens?.total ?? 0} tokens
                </span>
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-xs font-mono',
                    result.format === 'json'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600',
                  )}
                >
                  {result.format === 'json' ? 'Valid JSON' : 'Plain Text'}
                </span>
                {result.model && (
                  <span className="text-xs text-muted-foreground">
                    Model: {result.model}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ImportPreviewPanel({
  preview,
  importData,
  features,
  onCancel,
  onApply,
  isApplying,
}: {
  preview: ImportPreviewResponse;
  importData: PromptExportData;
  features: PromptFeatureInfo[];
  onCancel: () => void;
  onApply: () => void;
  isApplying: boolean;
}) {
  const featureLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of features) map[f.key] = f.label;
    return map;
  }, [features]);

  const changedEntries = Object.entries(preview.changes).filter(([, c]) => c.status !== 'unchanged');
  const unchangedCount = Object.values(preview.changes).filter((c) => c.status === 'unchanged').length;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Import Preview
        </h4>
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Importing from "<strong>{preview.profile}</strong>" ({preview.featureCount} feature{preview.featureCount !== 1 ? 's' : ''})
        {preview.exportedFrom && <> exported from {preview.exportedFrom}</>}
      </p>

      <div className="flex items-center gap-4 text-xs">
        {preview.summary.modified > 0 && (
          <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded">
            {preview.summary.modified} modified
          </span>
        )}
        {preview.summary.added > 0 && (
          <span className="bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">
            {preview.summary.added} added
          </span>
        )}
        {unchangedCount > 0 && (
          <span className="text-muted-foreground">
            {unchangedCount} unchanged
          </span>
        )}
      </div>

      {changedEntries.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {changedEntries.map(([key, change]) => (
            <div key={key} className="flex items-center gap-2 text-sm rounded px-2 py-1 bg-background/50">
              <span className={change.status === 'added' ? 'text-emerald-500' : 'text-amber-500'}>
                {change.status === 'added' ? '+' : '~'}
              </span>
              <span className="font-medium">{featureLabelMap[key] ?? key}</span>
              {change.status === 'modified' && change.tokenDelta !== undefined && change.tokenDelta !== 0 && (
                <span className="text-xs text-muted-foreground">
                  ({change.tokenDelta > 0 ? '+' : ''}{change.tokenDelta} tokens)
                </span>
              )}
              {change.after.model && (
                <span className="text-xs bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">
                  model: {change.after.model}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {changedEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">No changes to apply - all features already match.</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={isApplying || changedEntries.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isApplying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Importing...
            </>
          ) : (
            'Import & Apply'
          )}
        </button>
      </div>
    </div>
  );
}

export function AiPromptsTab({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const [features, setFeatures] = useState<PromptFeatureInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const queryClient = useQueryClient();
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const updateSetting = useUpdateSetting();
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<{ data: PromptExportData; preview: ImportPreviewResponse } | null>(null);
  const importApply = useImportApply();

  // Fetch models for per-feature model override
  const ollamaUrl = values['llm.ollama_url'] || 'http://host.docker.internal:11434';
  const globalModel = values['llm.model'] || 'llama3.2';
  const { data: modelsData } = useLlmModels(ollamaUrl);
  const models: LlmModel[] = modelsData?.models ?? [];

  useEffect(() => {
    const loadFeatures = async () => {
      try {
        const data = await api.get<{ features: PromptFeatureInfo[] }>('/api/settings/prompt-features');
        setFeatures(data.features);
      } catch {
        setFeatures([]);
      } finally {
        setLoading(false);
      }
    };
    void loadFeatures();
  }, [profileRefreshKey]);

  const handleProfileSwitch = useCallback(() => {
    // After switching profiles, refresh settings and feature data
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    setProfileRefreshKey((k) => k + 1);
  }, [queryClient]);

  // Initialize drafts from server values
  useEffect(() => {
    if (features.length === 0) return;
    const drafts: Record<string, string> = {};
    for (const f of features) {
      const promptKey = `prompts.${f.key}.system_prompt`;
      const modelKey = `prompts.${f.key}.model`;
      const tempKey = `prompts.${f.key}.temperature`;
      drafts[promptKey] = values[promptKey] || f.defaultPrompt;
      drafts[modelKey] = values[modelKey] || '';
      drafts[tempKey] = values[tempKey] || '';
    }
    setDraftValues(drafts);
    setSavedValues(drafts);
  }, [features, values]);

  const toggleFeature = (key: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedFeatures(new Set(features.map((f) => f.key)));
  };

  const collapseAll = () => {
    setExpandedFeatures(new Set());
  };

  const handleDraftChange = (key: string, value: string) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  const resetToDefault = (featureKey: string) => {
    const feature = features.find((f) => f.key === featureKey);
    if (!feature) return;
    const promptKey = `prompts.${featureKey}.system_prompt`;
    const modelKey = `prompts.${featureKey}.model`;
    const tempKey = `prompts.${featureKey}.temperature`;
    setDraftValues((prev) => ({
      ...prev,
      [promptKey]: feature.defaultPrompt,
      [modelKey]: '',
      [tempKey]: '',
    }));
    setSaveSuccess(false);
  };

  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(draftValues).some((k) => draftValues[k] !== savedValues[k]);
  }, [draftValues, savedValues]);

  const changedCount = useMemo(() => {
    return features.filter((f) => {
      const promptKey = `prompts.${f.key}.system_prompt`;
      return draftValues[promptKey] !== savedValues[promptKey];
    }).length;
  }, [draftValues, savedValues, features]);

  const isCustomized = (featureKey: string) => {
    const feature = features.find((f) => f.key === featureKey);
    if (!feature) return false;
    const promptKey = `prompts.${featureKey}.system_prompt`;
    const modelKey = `prompts.${featureKey}.model`;
    const tempKey = `prompts.${featureKey}.temperature`;
    const storedPrompt = values[promptKey] || feature.defaultPrompt;
    return storedPrompt !== feature.defaultPrompt || (values[modelKey] || '') !== '' || (values[tempKey] || '') !== '';
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    const changedKeys = Object.keys(draftValues).filter((k) => draftValues[k] !== savedValues[k]);
    try {
      for (const key of changedKeys) {
        await updateSetting.mutateAsync({
          key,
          value: draftValues[key],
          category: 'prompts',
          showToast: false,
        });
        onChange(key, draftValues[key]);
      }
      setSavedValues({ ...draftValues });
      setSaveSuccess(true);
      toast.success(`Saved ${changedKeys.length} prompt setting${changedKeys.length !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraftValues({ ...savedValues });
    setSaveSuccess(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Profile Selector */}
      <ProfileSelector
        onProfileSwitch={handleProfileSwitch}
        onImportPreview={(data, preview) => setImportPreviewData({ data, preview })}
      />

      {/* Import Preview Panel */}
      {importPreviewData && (
        <ImportPreviewPanel
          preview={importPreviewData.preview}
          importData={importPreviewData.data}
          features={features}
          onCancel={() => setImportPreviewData(null)}
          onApply={() => {
            importApply.mutate(importPreviewData.data, {
              onSuccess: () => {
                setImportPreviewData(null);
                handleProfileSwitch();
              },
            });
          }}
          isApplying={importApply.isPending}
        />
      )}

      <div className="border-t border-border" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Customize the system prompt, model, and temperature for each AI-powered feature.
            Changes only take effect when you click Save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Expand All
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Feature Accordions */}
      {features.map((feature) => {
        const isExpanded = expandedFeatures.has(feature.key);
        const promptKey = `prompts.${feature.key}.system_prompt`;
        const modelKey = `prompts.${feature.key}.model`;
        const tempKey = `prompts.${feature.key}.temperature`;
        const promptValue = draftValues[promptKey] || feature.defaultPrompt;
        const modelValue = draftValues[modelKey] || '';
        const tempValue = draftValues[tempKey] || '';
        const tokenCount = estimateTokens(promptValue);
        const customized = isCustomized(feature.key);
        const hasLocalChanges = draftValues[promptKey] !== savedValues[promptKey]
          || draftValues[modelKey] !== savedValues[modelKey]
          || draftValues[tempKey] !== savedValues[tempKey];

        return (
          <div key={feature.key} className="rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => toggleFeature(feature.key)}
              className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <MessageSquare className="h-4 w-4" />
                <span className="font-medium">{feature.label}</span>
                {customized && (
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    customized
                  </span>
                )}
                {hasLocalChanges && (
                  <span className="text-xs bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded">
                    unsaved
                  </span>
                )}
              </div>
              <TokenBadge count={tokenCount} />
            </button>

            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4">
                <p className="text-sm text-muted-foreground">{feature.description}</p>

                {/* Model & Temperature Override */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Model Override</label>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Leave empty to use global default ({globalModel})
                    </p>
                    {models.length > 0 ? (
                      <ThemedSelect
                        value={modelValue || '__global_default__'}
                        onValueChange={(val) => handleDraftChange(modelKey, val === '__global_default__' ? '' : val)}
                        options={[
                          { value: '__global_default__', label: 'Use Global Default' },
                          ...models.map((m) => ({
                            value: m.name,
                            label: `${m.name}${m.size ? ` (${formatBytes(m.size)})` : ''}`,
                          })),
                        ]}
                        className="w-full"
                      />
                    ) : (
                      <input
                        type="text"
                        value={modelValue}
                        onChange={(e) => handleDraftChange(modelKey, e.target.value)}
                        placeholder="Use Global Default"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Temperature Override</label>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Leave empty to use global default
                    </p>
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => handleDraftChange(tempKey, e.target.value)}
                      placeholder="Use Global Default"
                      min={0}
                      max={2}
                      step={0.1}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                {/* System Prompt Textarea */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium">System Prompt</label>
                    <TokenBadge count={tokenCount} />
                  </div>
                  <textarea
                    value={promptValue}
                    onChange={(e) => handleDraftChange(promptKey, e.target.value)}
                    className="min-h-[160px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Enter system prompt..."
                  />
                </div>

                {/* Test Prompt & Reset to Default */}
                <div className="flex items-center justify-between">
                  <PromptTestPanel
                    feature={feature.key}
                    systemPrompt={promptValue}
                    model={modelValue}
                    temperature={tempValue}
                  />
                  <button
                    type="button"
                    onClick={() => resetToDefault(feature.key)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to Default
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Save Bar */}
      {(hasUnsavedChanges || saveSuccess) && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2">
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Info className="h-4 w-4 text-amber-500" />
              )}
              <span className="text-sm">
                {isSaving
                  ? 'Saving...'
                  : saveSuccess
                    ? 'All changes saved'
                    : `${changedCount} feature${changedCount !== 1 ? 's' : ''} modified`}
              </span>
            </div>
            {hasUnsavedChanges && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={isSaving}
                  className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save & Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = useAuth();
  const { theme, setTheme, toggleThemes, setToggleThemes, dashboardBackground, setDashboardBackground, iconTheme, setIconTheme, faviconIcon, setFaviconIcon, sidebarIcon, setSidebarIcon, loginIcon, setLoginIcon } = useThemeStore();
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  type SettingsTab = 'general' | 'appearance' | 'portainer-backup' | 'users' | 'webhooks' | 'ai-prompts';
  const validTabs: SettingsTab[] = ['general', 'appearance', 'portainer-backup', 'users', 'webhooks', 'ai-prompts'];
  const initialTab = validTabs.includes(searchParams.get('tab') as SettingsTab)
    ? (searchParams.get('tab') as SettingsTab)
    : 'general';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const isRecommendedLookActive =
    theme === DEFAULT_THEME &&
    dashboardBackground === DEFAULT_DASHBOARD_BACKGROUND &&
    toggleThemes[0] === DEFAULT_TOGGLE_THEMES[0] &&
    toggleThemes[1] === DEFAULT_TOGGLE_THEMES[1] &&
    iconTheme === DEFAULT_ICON_THEME &&
    faviconIcon === DEFAULT_FAVICON_ICON &&
    sidebarIcon === DEFAULT_SIDEBAR_ICON &&
    loginIcon === DEFAULT_LOGIN_ICON;

  const applyRecommendedLook = useCallback(() => {
    setTheme(DEFAULT_THEME);
    setDashboardBackground(DEFAULT_DASHBOARD_BACKGROUND);
    setToggleThemes([...DEFAULT_TOGGLE_THEMES]);
    setIconTheme(DEFAULT_ICON_THEME);
    setFaviconIcon(DEFAULT_FAVICON_ICON);
    setSidebarIcon(DEFAULT_SIDEBAR_ICON);
    setLoginIcon(DEFAULT_LOGIN_ICON);
    toast.success('Applied recommended appearance preset');
  }, [setDashboardBackground, setIconTheme, setTheme, setToggleThemes, setFaviconIcon, setSidebarIcon, setLoginIcon]);

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
      setSaveSuccess(false);
      setSaveError(null);
      setRestartPending(false);
    }
  }, [settingsData]);

  // Calculate if there are changes
  const hasChanges = useMemo(() => {
    return Object.keys(editedValues).some(
      (key) => editedValues[key] !== originalValues[key]
    );
  }, [editedValues, originalValues]);

  const restartKeys = useMemo(() => [
    'monitoring.polling_interval',
    'monitoring.enabled',
    'llm.ollama_url',
    'llm.model',
    'llm.custom_endpoint_enabled',
    'llm.custom_endpoint_url',
    'llm.custom_endpoint_token',
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
  ], []);

  // Get changed settings that require restart
  const changesRequireRestart = useMemo(() => {
    return restartKeys.some(
      (key) => editedValues[key] !== originalValues[key]
    );
  }, [editedValues, originalValues, restartKeys]);

  // Handle value change
  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
    setSaveError(null);
  };

  const saveChangedSettings = useCallback(async (
    editedSnapshot: Record<string, string>,
    originalSnapshot: Record<string, string>,
  ) => {
    const changedKeys = Object.keys(editedSnapshot).filter(
      (key) => editedSnapshot[key] !== originalSnapshot[key]
    );
    if (changedKeys.length === 0) return;

    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    let hadFailure = false;
    const appliedValues: Record<string, string> = {};
    let appliedRestartSetting = false;

    for (const key of changedKeys) {
      try {
        await updateSetting.mutateAsync({
          key,
          value: editedSnapshot[key],
          category: SETTING_CATEGORY_BY_KEY[key],
          showToast: false,
        });
        appliedValues[key] = editedSnapshot[key];
        if (restartKeys.includes(key)) {
          appliedRestartSetting = true;
        }
      } catch {
        hadFailure = true;
      }
    }

    if (Object.keys(appliedValues).length > 0) {
      setOriginalValues((prev) => ({ ...prev, ...appliedValues }));
      setSaveSuccess(true);
      if (appliedRestartSetting) {
        setRestartPending(true);
      }
    }

    if (hadFailure) {
      setSaveError('Failed to auto-save some settings');
      toast.error('Failed to auto-save some settings');
    }

    setIsSaving(false);
  }, [restartKeys, updateSetting]);

  useEffect(() => {
    if (isSaving || !hasChanges) return;
    const editedSnapshot = { ...editedValues };
    const originalSnapshot = { ...originalValues };
    const timeout = window.setTimeout(() => {
      void saveChangedSettings(editedSnapshot, originalSnapshot);
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [editedValues, hasChanges, isSaving, originalValues, saveChangedSettings]);

  // Handle reset
  const handleReset = () => {
    setEditedValues({ ...originalValues });
    setSaveSuccess(false);
    setSaveError(null);
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
          {isSaving && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving changes...
            </div>
          )}
          {!isSaving && saveError && (
            <div className="text-sm text-destructive">{saveError}</div>
          )}
          {!isSaving && !saveError && saveSuccess && !hasChanges && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              All changes saved
            </div>
          )}
          {hasChanges && (
            <button
              onClick={handleReset}
              disabled={isSaving}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Restart Warning */}
      {(changesRequireRestart || restartPending) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-500">Restart Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Some settings changes require a backend restart to take effect.
              Changes are auto-saved; restart the backend service to apply them.
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
            value="appearance"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <Palette className="h-4 w-4" />
            Appearance
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
          {role === 'admin' && (
            <Tabs.Trigger
              value="ai-prompts"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              <Bot className="h-4 w-4" />
              AI Prompts
            </Tabs.Trigger>
          )}
          {role === 'admin' && (
            <Tabs.Trigger
              value="ai-feedback"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              <ThumbsUp className="h-4 w-4" />
              AI Feedback
            </Tabs.Trigger>
          )}
        </Tabs.List>

        {/* General Tab */}
        <Tabs.Content value="general" className="space-y-6 focus:outline-none">

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
        status={editedValues['oidc.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['oidc.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
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
        status={editedValues['monitoring.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['monitoring.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
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
        status={editedValues['anomaly.detection_enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['anomaly.detection_enabled'] === 'true' ? 'Enabled' : 'Disabled'}
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
        footerContent={<NotificationTestButtons />}
        status={
          editedValues['notifications.teams_enabled'] === 'true' || editedValues['notifications.email_enabled'] === 'true'
            ? 'configured'
            : 'not-configured'
        }
        statusLabel={
          editedValues['notifications.teams_enabled'] === 'true' || editedValues['notifications.email_enabled'] === 'true'
            ? 'Enabled'
            : 'Disabled'
        }
      />

      {/* Notification History */}
      <NotificationHistoryPanel />

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
        status="configured"
      />

      {/* LLM Settings */}
      <LlmSettingsSection
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        disabled={isSaving}
      />

      {/* MCP Servers */}
      <McpServersSection />

      {/* MCP Tool Settings */}
      <SettingsSection
        title="MCP Tool Configuration"
        icon={<Wrench className="h-5 w-5" />}
        category="mcp"
        settings={DEFAULT_SETTINGS.mcp}
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
        status={editedValues['status.page.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['status.page.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
      />

      {/* Elasticsearch Settings */}
      <ElasticsearchSettingsSection
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        disabled={isSaving}
      />

      <SecurityAuditSettingsSection />

      {/* System Info */}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            <h2 className="text-lg font-semibold">System Information</h2>
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
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 md:col-span-2 lg:col-span-3">
            <h3 className="text-sm font-semibold">Cache Info</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Entries</p>
                <p className="font-medium mt-1">{cacheStats?.size ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Hits</p>
                <p className="font-medium mt-1">{cacheStats?.hits ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Misses</p>
                <p className="font-medium mt-1">{cacheStats?.misses ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Hit Rate</p>
                <p className="font-medium mt-1">{cacheStats?.hitRate ?? 'N/A'}</p>
              </div>
            </div>
            {cacheStats?.entries && cacheStats.entries.length > 0 && (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                  <p className="text-xs font-medium">Redis Keys</p>
                  <p className="mt-1 text-lg font-semibold">{redisSystemInfo.keys}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Count of keys currently stored in Redis (L2 cache). More keys means more reusable cached responses.
                  </p>
                </div>
                <div className="rounded-lg border border-border/50 bg-muted/20">
                  <div className="border-b border-border/50 px-3 py-2">
                    <p className="text-xs font-medium">Cached Entry Keys</p>
                    <p className="text-xs text-muted-foreground">
                      Internal cache identifiers used by the backend for stored query results.
                    </p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium">Key</th>
                        <th className="p-3 text-right font-medium">Expires In (TTL)</th>
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
              </div>
            )}
          </div>
        </div>
      </div>

        </Tabs.Content>

        {/* Appearance Tab */}
        <Tabs.Content value="appearance" className="space-y-6 focus:outline-none">
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Appearance</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Choose your preferred color theme for the dashboard.
        </p>
        <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div>
            <p className="text-sm font-medium">Recommended Look</p>
            <p className="text-xs text-muted-foreground">
              Glass Light + Mesh Particles with Light/Dark glass toggle.
            </p>
          </div>
          <button
            onClick={applyRecommendedLook}
            disabled={isRecommendedLookActive}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRecommendedLookActive ? 'Applied' : 'Apply'}
          </button>
        </div>

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

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Icon Style</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Change the visual weight of icons across the dashboard.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {iconThemeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setIconTheme(option.value)}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                  iconTheme === option.value
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

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Favicon Icon</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose which icon appears in the browser tab.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ICON_SETS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => setFaviconIcon(icon.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                  faviconIcon === icon.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-green-500">
                  <svg viewBox={icon.viewBox} className="h-6 w-6">
                    {icon.paths.map((p, i) => (
                      <path
                        key={i}
                        d={p.d}
                        fill={p.fill === 'currentColor' ? '#fff' : (p.fill ?? 'none')}
                        stroke={p.stroke === 'currentColor' ? '#fff' : (p.stroke ?? 'none')}
                        strokeWidth={p.strokeWidth}
                        strokeLinecap={p.strokeLinecap}
                        strokeLinejoin={p.strokeLinejoin}
                      />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{icon.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Sidebar Logo</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose which icon appears in the sidebar brand area.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ICON_SETS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => setSidebarIcon(icon.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                  sidebarIcon === icon.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <svg viewBox={icon.viewBox} className="h-5 w-5 text-foreground">
                    {icon.paths.map((p, i) => (
                      <path
                        key={i}
                        d={p.d}
                        fill={p.fill ?? 'none'}
                        stroke={p.stroke ?? 'none'}
                        strokeWidth={p.strokeWidth}
                        strokeLinecap={p.strokeLinecap}
                        strokeLinejoin={p.strokeLinejoin}
                      />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{icon.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Login Logo</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose which icon appears on the login page with gradient animation.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ICON_SETS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => setLoginIcon(icon.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                  loginIcon === icon.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
                  <svg viewBox={icon.viewBox} className="h-6 w-6">
                    <defs>
                      <linearGradient id={`login-preview-${icon.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="oklch(72% 0.14 244)" />
                        <stop offset="100%" stopColor="oklch(78% 0.18 158)" />
                      </linearGradient>
                    </defs>
                    {icon.paths.map((p, i) => (
                      <path
                        key={i}
                        d={p.d}
                        fill={p.fill === 'currentColor' ? `url(#login-preview-${icon.id})` : (p.fill ?? 'none')}
                        stroke={p.stroke === 'currentColor' ? `url(#login-preview-${icon.id})` : (p.stroke ?? 'none')}
                        strokeWidth={p.strokeWidth}
                        strokeLinecap={p.strokeLinecap}
                        strokeLinejoin={p.strokeLinejoin}
                      />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{icon.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
                </div>
              </button>
            ))}
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
        status={editedValues['portainer_backup.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['portainer_backup.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
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
          <SettingsSection
            title="Webhook Service"
            icon={<Webhook className="h-5 w-5" />}
            category="webhooks"
            settings={DEFAULT_SETTINGS.webhooks}
            values={editedValues}
            originalValues={originalValues}
            onChange={handleChange}
            requiresRestart
            disabled={isSaving}
            status={editedValues['webhooks.enabled'] === 'true' ? 'configured' : 'not-configured'}
            statusLabel={editedValues['webhooks.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
          />
        </Tabs.Content>

        {role === 'admin' && (
          <Tabs.Content value="ai-prompts" className="space-y-6 focus:outline-none">
            <AiPromptsTab values={editedValues} onChange={handleChange} />
          </Tabs.Content>
        )}

        {role === 'admin' && (
          <Tabs.Content value="ai-feedback" className="space-y-6 focus:outline-none">
            <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <LazyAiFeedbackPanel />
            </Suspense>
          </Tabs.Content>
        )}
      </Tabs.Root>
    </div>
  );
}
