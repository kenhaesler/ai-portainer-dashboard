import { useState, useMemo, lazy, Suspense } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { SettingsSection, SettingRow, DEFAULT_SETTINGS, REDACTED_SECRET, type SettingsTabProps } from '../shared';
import { useLlmModels, useLlmTestConnection, type LlmModel } from '@/features/ai-intelligence/hooks/use-llm-models';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { DataTable, type ColumnDef } from '@/shared/components/tables/data-table';
import { cn, formatBytes } from '@/shared/lib/utils';
import { api } from '@/shared/lib/api';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { getModelUseCase, MODEL_USE_CASE_TABLE } from '../model-use-cases';
import { McpServersSection } from './mcp-servers';
import { AiPromptsTab } from './prompts';

const LazyAiFeedbackPanel = lazy(() => import('@/features/core/pages/settings-ai-feedback').then((m) => ({ default: m.AiFeedbackPanel })));

/** Row shape of the model use-case reference table (rendered via DataTable). */
type ModelUseCaseRow = (typeof MODEL_USE_CASE_TABLE)[number];

/** Keys that belong to LLM configuration (excluded from parent auto-save). */
export const LLM_SETTING_KEYS = DEFAULT_SETTINGS.llm.map((s) => s.key);

interface AiLlmTabProps extends SettingsTabProps {
  role: string;
  /** Explicit save for LLM settings (not auto-saved). */
  saveLlmSettings: () => Promise<void>;
  /** Whether there are unsaved LLM changes. */
  hasLlmChanges: boolean;
  /** Reset LLM values to their last-saved state. */
  resetLlmValues: () => void;
}

export function AiLlmTab({
  editedValues,
  originalValues,
  onChange,
  isSaving,
  role,
  saveLlmSettings,
  hasLlmChanges,
  resetLlmValues,
}: AiLlmTabProps) {
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmSaveSuccess, setLlmSaveSuccess] = useState(false);

  const handleSaveLlm = async () => {
    setLlmSaving(true);
    setLlmSaveSuccess(false);
    try {
      await saveLlmSettings();
      setLlmSaveSuccess(true);
    } finally {
      setLlmSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* LLM Settings — explicit save, not auto-save */}
      <LlmSettingsSection
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving || llmSaving}
      />

      {/* LLM Save Bar */}
      {(hasLlmChanges || llmSaveSuccess) && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2">
              {llmSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : llmSaveSuccess && !hasLlmChanges ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Info className="h-4 w-4 text-amber-500" />
              )}
              <span className="text-sm">
                {llmSaving
                  ? 'Saving LLM settings...'
                  : llmSaveSuccess && !hasLlmChanges
                    ? 'LLM settings saved'
                    : 'LLM settings have unsaved changes'}
              </span>
            </div>
            {hasLlmChanges && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetLlmValues}
                  disabled={llmSaving}
                  className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveLlm()}
                  disabled={llmSaving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save LLM Settings
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
        onChange={onChange}
        disabled={isSaving}
      />

      {/* AI Prompts */}
      {role === 'admin' && (
        <AiPromptsTab values={editedValues} onChange={onChange} />
      )}

      {/* AI Feedback */}
      {role === 'admin' && (
        <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
          <LazyAiFeedbackPanel />
        </Suspense>
      )}

      {/* Advanced AI Tuning — Category B env vars moved to Settings DB (#993) */}
      {role === 'admin' && (
        <AdvancedAiTuningSection
          editedValues={editedValues}
          originalValues={originalValues}
          onChange={onChange}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}

// ─── LLM Settings Section ───────────────────────────────────────────

/**
 * Mirrors the backend `resolveChatCompletionsUrl` so the Settings UI can
 * preview the URL the backend will actually POST to. Keep in sync with
 * `packages/ai-intelligence/src/services/llm-client.ts`.
 */
function resolveCustomChatUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

interface LlmSettingsSectionProps {
  values: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

export function LlmSettingsSection({ values, originalValues, onChange, disabled }: LlmSettingsSectionProps) {
  const selectedModel = values['llm.model'] || '';
  const temperature = values['llm.temperature'] || '0.7';
  const maxTokens = values['llm.max_tokens'] || '2048';
  const apiUrl = values['llm.api_url'] || '';
  const resolvedChatUrl = resolveCustomChatUrl(apiUrl);
  const apiUrlAutoAppended = Boolean(apiUrl.trim()) && resolvedChatUrl !== apiUrl.trim().replace(/\/+$/, '');
  const apiToken = values['llm.api_token'] || '';
  const authType = values['llm.auth_type'] || 'bearer';

  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useLlmModels(apiUrl || undefined);
  const testConnection = useLlmTestConnection();
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [showUseCaseTable, setShowUseCaseTable] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>();

  const models: LlmModel[] = modelsData?.models ?? [];

  const hasChanges = [
    'llm.model', 'llm.temperature', 'llm.max_tokens',
    'llm.api_url', 'llm.api_token', 'llm.auth_type',
  ].some((key) => values[key] !== originalValues[key]);
  const llmConfigured = Boolean(selectedModel.trim()) && Boolean(apiUrl.trim());

  const handleScanModels = () => {
    void queryClient.invalidateQueries({ queryKey: ['llm-models', apiUrl] });
    void refetchModels();
  };

  const handleTestConnection = () => {
    if (!apiUrl.trim()) {
      setConnectionStatus('error');
      setConnectionError('API endpoint URL is required.');
      toast.error('Set an API endpoint URL before testing connection');
      return;
    }

    const body = {
      url: apiUrl.trim(),
      token: apiToken && apiToken !== REDACTED_SECRET ? apiToken : undefined,
      authType: authType as 'bearer' | 'basic',
    };
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

  const activeBackendUrl = apiUrl || 'No URL set';

  // Reference table of model use-cases (DataTable). Static data → no autoFit
  // (this is a fixed sub-panel, not a full page), no search, no row clicks.
  // text-xs cell classNames preserve the original compact look.
  const useCaseColumns = useMemo<ColumnDef<ModelUseCaseRow, unknown>[]>(() => [
    {
      accessorKey: 'models',
      header: 'Model',
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-foreground">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'label',
      header: 'Label',
      enableSorting: false,
      cell: ({ row }) => (
        <span className={cn('text-xs font-semibold whitespace-nowrap', row.original.color)}>
          {row.original.label}
        </span>
      ),
    },
    {
      accessorKey: 'description',
      // Hide the header too on narrow viewports so it doesn't sit above empty
      // cells (the original column collapsed entirely below `sm`).
      header: () => <span className="hidden sm:inline">Description</span>,
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="hidden text-xs text-muted-foreground sm:inline">{getValue<string>()}</span>
      ),
    },
  ], []);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <h2 className="text-lg font-semibold">LLM Configuration</h2>
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
            <div className="flex items-center gap-1.5 text-xs text-blue-500 bg-blue-500/10 px-2 py-1 rounded">
              <RefreshCw className="h-3 w-3" />
              Unsaved changes
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* OpenAI-compatible API configuration */}
        <div className="rounded-lg border border-border p-4 bg-muted/30 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">API Endpoint</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect to any OpenAI-compatible chat-completions API. Use the Test Connection button below to verify reachability and discover available models.
            </p>
          </div>
          <div>
            <label htmlFor="llm-api-url" className="text-sm font-medium">API Endpoint URL</label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Base URL of an OpenAI-compatible server (OpenAI, LM Studio, vLLM, LiteLLM, OpenWebUI, Anthropic via proxy, etc.). <code className="text-[11px]">/v1/chat/completions</code> is appended automatically. Paste a full chat-completions URL only if your provider uses a non-standard path (e.g., Open WebUI's <code className="text-[11px]">/api/chat/completions</code>).
            </p>
            <input
              id="llm-api-url"
              type="text"
              value={apiUrl}
              onChange={(e) => onChange('llm.api_url', e.target.value)}
              disabled={disabled}
              placeholder="http://lmstudio:1234"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            {resolvedChatUrl && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {apiUrlAutoAppended ? (
                  <>
                    Will POST to <code className="text-[11px] text-foreground/80">{resolvedChatUrl}</code>
                  </>
                ) : (
                  <>Using URL as-is (already a chat-completions endpoint).</>
                )}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="llm-api-token" className="text-sm font-medium">API Key / Bearer Token</label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Optional — leave empty if the endpoint doesn't require authentication
            </p>
            <div className="relative">
              <input
                id="llm-api-token"
                type={showToken ? 'text' : 'password'}
                value={apiToken}
                onChange={(e) => onChange('llm.api_token', e.target.value)}
                disabled={disabled}
                placeholder="sk-... (optional)"
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
          <div>
            <label htmlFor="auth-type-select" className="text-sm font-medium">Auth Header Type</label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Bearer works with most providers. Use Basic only for endpoints that require HTTP Basic auth.
            </p>
            <select
              id="auth-type-select"
              value={authType}
              onChange={(e) => onChange('llm.auth_type', e.target.value)}
              disabled={disabled}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="bearer">Bearer (default)</option>
              <option value="basic">Basic</option>
            </select>
          </div>

          {/* Test Connection — verifies the API URL + token can list models */}
          <div className="border-t border-border/60 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {testConnection.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                ) : connectionIcon}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {testConnection.isPending ? 'Testing...' : connectionLabel}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {connectionStatus === 'error' && connectionError
                      ? connectionError
                      : activeBackendUrl}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testConnection.isPending || disabled}
                className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50 shrink-0"
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

        {/* Model Selection */}
        <div className="space-y-2 border-t border-border pt-4">
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
          {selectedModel && (() => {
            const useCase = getModelUseCase(selectedModel);
            return (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
                <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shrink-0', useCase.color)} style={{ backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)', borderColor: 'color-mix(in srgb, currentColor 25%, transparent)' }}>
                  {useCase.label}
                </span>
                <span className="text-xs text-muted-foreground min-w-0">{useCase.description}</span>
                <button
                  type="button"
                  onClick={() => setShowUseCaseTable((v) => !v)}
                  className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="View all model use-cases"
                >
                  {showUseCaseTable ? 'Hide' : 'All models'}
                  {showUseCaseTable ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              </div>
            );
          })()}
          {showUseCaseTable && (
            <div className="mt-2">
              <DataTable
                columns={useCaseColumns}
                data={MODEL_USE_CASE_TABLE}
                getRowId={(row) => row.models}
                hideSearch
                windowScroll
              />
            </div>
          )}
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

      </div>
    </div>
  );
}

/** Collapsible section for AI tuning knobs (Category B env vars moved to Settings DB). */
function AdvancedAiTuningSection({ editedValues, originalValues, onChange, isSaving }: SettingsTabProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Wrench className="h-4 w-4" />
          <span className="font-medium">Advanced AI Tuning</span>
          <span className="text-xs text-muted-foreground">Anomaly detection, investigation, and ML parameters</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4">
          {DEFAULT_SETTINGS.aiTuning.map((setting) => (
            <SettingRow
              key={setting.key}
              setting={setting}
              value={editedValues[setting.key] ?? setting.defaultValue}
              onChange={(value) => onChange(setting.key, value)}
              hasChanges={editedValues[setting.key] !== originalValues[setting.key]}
              disabled={isSaving}
            />
          ))}
        </div>
      )}
    </div>
  );
}
