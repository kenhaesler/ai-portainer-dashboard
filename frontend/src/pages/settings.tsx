import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { useThemeStore, themeOptions, type Theme } from '@/stores/theme-store';
import { useSettings, useUpdateSetting } from '@/hooks/use-settings';
import { useCacheStats, useCacheClear } from '@/hooks/use-cache-admin';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';

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
    { key: 'llm.model', label: 'LLM Model', description: 'Ollama model to use for AI features', type: 'select', defaultValue: 'llama3.2', options: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'gemma2'] },
    { key: 'llm.temperature', label: 'Temperature', description: 'Creativity of LLM responses (0-1)', type: 'number', defaultValue: '0.7', min: 0, max: 1, step: 0.1 },
    { key: 'llm.ollama_url', label: 'Ollama URL', description: 'URL of the Ollama server', type: 'string', defaultValue: 'http://ollama:11434' },
    { key: 'llm.max_tokens', label: 'Max Tokens', description: 'Maximum tokens in LLM response', type: 'number', defaultValue: '2048', min: 256, max: 8192 },
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
  elasticsearch: [
    { key: 'elasticsearch.enabled', label: 'Enable Elasticsearch', description: 'Enable Elasticsearch/Kibana integration for edge agent logs', type: 'boolean', defaultValue: 'false' },
    { key: 'elasticsearch.endpoint', label: 'Elasticsearch URL', description: 'URL of your Elasticsearch cluster (e.g., https://localhost:9200)', type: 'string', defaultValue: '' },
    { key: 'elasticsearch.api_key', label: 'API Key', description: 'Elasticsearch API key for authentication (keep blank for no auth)', type: 'password', defaultValue: '' },
    { key: 'elasticsearch.index_pattern', label: 'Index Pattern', description: 'Index pattern for log searching (e.g., logs-* or filebeat-*)', type: 'string', defaultValue: 'logs-*' },
    { key: 'elasticsearch.verify_ssl', label: 'Verify SSL', description: 'Verify SSL certificates when connecting', type: 'boolean', defaultValue: 'true' },
  ],
} as const;

type SettingCategory = keyof typeof DEFAULT_SETTINGS;

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'system') return <Monitor className="h-4 w-4" />;
  if (theme === 'light') return <Sun className="h-4 w-4" />;
  if (theme.startsWith('apple')) return <Sparkles className="h-4 w-4" />;
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

  if (setting.type === 'select' && 'options' in setting) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {setting.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
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

function NotificationTestButtons() {
  const [testingTeams, setTestingTeams] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  const handleTest = async (channel: 'teams' | 'email') => {
    const setTesting = channel === 'teams' ? setTestingTeams : setTestingEmail;
    setTesting(true);
    try {
      await api.post('/api/notifications/test', { channel });
      toast.success(`Test ${channel} notification sent successfully`);
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

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore();
  const { data: settingsData, isLoading, isError, error, refetch } = useSettings();
  const updateSetting = useUpdateSetting();
  const { data: cacheStats } = useCacheStats();
  const cacheClear = useCacheClear();

  // Local state for edited values
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
      </div>

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
      <SettingsSection
        title="LLM / Ollama"
        icon={<Bot className="h-5 w-5" />}
        category="llm"
        settings={DEFAULT_SETTINGS.llm}
        values={editedValues}
        originalValues={originalValues}
        onChange={handleChange}
        requiresRestart
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Application</p>
            <p className="font-medium mt-1">Container-Infrastructure</p>
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
        </div>
      </div>
    </div>
  );
}
