import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Search,
  Webhook,
  Wifi,
} from 'lucide-react';
import { SettingsSection, DEFAULT_SETTINGS, REDACTED_SECRET, type SettingsTabProps } from './shared';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const LazyWebhooksPanel = lazy(() => import('@/pages/webhooks').then((m) => ({ default: m.WebhooksPanel })));

export function IntegrationsTab({ editedValues, originalValues, onChange, isSaving }: SettingsTabProps) {
  return (
    <div className="space-y-6">
      {/* Webhooks */}
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
        onChange={onChange}
        requiresRestart
        disabled={isSaving}
        status={editedValues['webhooks.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['webhooks.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
      />

      {/* Elasticsearch Settings */}
      <ElasticsearchSettingsSection
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving}
      />

      {/* Edge Agent Settings */}
      <SettingsSection
        title="Edge Agent"
        icon={<Wifi className="h-5 w-5" />}
        category="edgeAgent"
        settings={DEFAULT_SETTINGS.edgeAgent}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
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
        onChange={onChange}
        disabled={isSaving}
        status={editedValues['status.page.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['status.page.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
      />
    </div>
  );
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
