import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  Play,
  Plug,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Save,
  ThumbsUp,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  Pencil,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { SettingsSection, DEFAULT_SETTINGS, type SettingsTabProps } from './shared';
import { useLlmModels, useLlmTestConnection, useLlmTestPrompt } from '@/hooks/use-llm-models';
import {
  useMcpServers,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useConnectMcpServer,
  useDisconnectMcpServer,
  useMcpServerTools,
  type McpServer,
} from '@/hooks/use-mcp';
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
import { useUpdateSetting, useDeleteSetting } from '@/hooks/use-settings';
import { ThemedSelect } from '@/components/shared/themed-select';
import { cn, formatBytes } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { LlmModel, LlmTestPromptResponse } from '@/hooks/use-llm-models';

const LazyAiFeedbackPanel = lazy(() => import('@/pages/settings-ai-feedback').then((m) => ({ default: m.AiFeedbackPanel })));

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
    </div>
  );
}

// ─── LLM Settings Section ───────────────────────────────────────────

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
  const authType = values['llm.auth_type'] || 'bearer';

  const modelsHost = customEnabled ? undefined : ollamaUrl;
  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useLlmModels(modelsHost);
  const testConnection = useLlmTestConnection();
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>();

  const models: LlmModel[] = modelsData?.models ?? [];

  const hasChanges = [
    'llm.model', 'llm.temperature', 'llm.ollama_url', 'llm.max_tokens',
    'llm.custom_endpoint_enabled', 'llm.custom_endpoint_url', 'llm.custom_endpoint_token', 'llm.auth_type',
  ].some((key) => values[key] !== originalValues[key]);
  const llmConfigured = Boolean(selectedModel.trim()) && (customEnabled ? Boolean(customUrl.trim()) : Boolean(ollamaUrl.trim()));

  const handleScanModels = () => {
    void queryClient.invalidateQueries({ queryKey: ['llm-models', modelsHost] });
    void refetchModels();
  };

  const handleTestConnection = () => {
    if (customEnabled && !customUrl.trim()) {
      setConnectionStatus('error');
      setConnectionError('API endpoint URL is required.');
      toast.error('Set an API endpoint URL before testing connection');
      return;
    }

    const body = customEnabled
      ? { url: customUrl.trim(), token: customToken || undefined }
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

  const activeBackendUrl = customEnabled ? customUrl || 'No URL set' : ollamaUrl;

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
            <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
              <RefreshCw className="h-3 w-3" />
              Requires restart
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Backend Selection */}
        <div className="space-y-3">
          <div>
            <label className="font-medium">LLM Backend</label>
            <p className="text-sm text-muted-foreground mt-0.5">Choose how to connect to your LLM</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onChange('llm.custom_endpoint_enabled', 'false')}
              disabled={disabled}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-colors',
                !customEnabled
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span className="text-sm font-medium">Ollama (Local)</span>
              <span className="text-xs text-muted-foreground">Connect to a local or remote Ollama instance</span>
            </button>
            <button
              type="button"
              onClick={() => onChange('llm.custom_endpoint_enabled', 'true')}
              disabled={disabled}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-colors',
                customEnabled
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span className="text-sm font-medium">Custom API</span>
              <span className="text-xs text-muted-foreground">OpenAI-compatible endpoint (Open WebUI, vLLM, etc.)</span>
            </button>
          </div>
        </div>

        {/* Backend-specific configuration */}
        <div className="rounded-lg border border-border p-4 bg-muted/30 space-y-4">
          {!customEnabled ? (
            <div>
              <label htmlFor="ollama-url" className="text-sm font-medium">Ollama URL</label>
              <p className="text-xs text-muted-foreground mb-1.5">URL of the Ollama server</p>
              <input
                id="ollama-url"
                type="text"
                value={ollamaUrl}
                onChange={(e) => onChange('llm.ollama_url', e.target.value)}
                disabled={disabled}
                placeholder="http://host.docker.internal:11434"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="custom-endpoint-url" className="text-sm font-medium">API Endpoint URL</label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  OpenAI-compatible chat completions URL (e.g., http://host.docker.internal:3000/api/chat/completions)
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
                  Optional — leave empty if the endpoint doesn't require authentication
                </p>
                <div className="relative">
                  <input
                    id="custom-endpoint-token"
                    type={showToken ? 'text' : 'password'}
                    value={customToken}
                    onChange={(e) => onChange('llm.custom_endpoint_token', e.target.value)}
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
                  Bearer works with most proxies including ParisNeo Ollama Proxy (user:token format). Use Basic only for endpoints that require HTTP Basic auth.
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
            </>
          )}
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

        {/* Test Connection */}
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
                    : activeBackendUrl}
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

// ─── MCP Servers ────────────────────────────────────────────────────

export function McpServerRow({ server }: { server: McpServer }) {
  const connectMutation = useConnectMcpServer();
  const disconnectMutation = useDisconnectMcpServer();
  const deleteMutation = useDeleteMcpServer();
  const updateMutation = useUpdateMcpServer();
  const [showTools, setShowTools] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    transport: server.transport,
    command: server.command || '',
    url: server.url || '',
  });
  const toolsQuery = useMcpServerTools(server.id, showTools && server.connected);

  const handleSaveEdit = () => {
    const body: Record<string, string> = { transport: editData.transport };
    if (editData.transport === 'stdio') body.command = editData.command;
    else body.url = editData.url;
    updateMutation.mutate({ id: server.id, body }, {
      onSuccess: () => setIsEditing(false),
    });
  };

  const handleCancelEdit = () => {
    setEditData({
      transport: server.transport,
      command: server.command || '',
      url: server.url || '',
    });
    setIsEditing(false);
  };

  const isRequiredFieldEmpty = editData.transport === 'stdio'
    ? !editData.command.trim()
    : !editData.url.trim();

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
          <button
            onClick={() => {
              setEditData({
                transport: server.transport,
                command: server.command || '',
                url: server.url || '',
              });
              setIsEditing(!isEditing);
            }}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
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
      {isEditing && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Transport</label>
            <select
              value={editData.transport}
              onChange={e => setEditData(p => ({ ...p, transport: e.target.value as 'stdio' | 'sse' | 'http' }))}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              <option value="stdio">stdio (local command)</option>
              <option value="sse">SSE (remote)</option>
              <option value="http">HTTP (streamable)</option>
            </select>
          </div>
          {editData.transport === 'stdio' ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Command</label>
              <input
                value={editData.command}
                onChange={e => setEditData(p => ({ ...p, command: e.target.value }))}
                placeholder="npx -y @modelcontextprotocol/server-filesystem /data"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">URL</label>
              <input
                value={editData.url}
                onChange={e => setEditData(p => ({ ...p, url: e.target.value }))}
                placeholder="http://mcp-server:3000/sse"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancelEdit}
              className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={isRequiredFieldEmpty || updateMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
          {updateMutation.isError && (
            <p className="text-xs text-red-400">{updateMutation.error.message}</p>
          )}
        </div>
      )}
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

// ─── AI Prompts Tab ─────────────────────────────────────────────────

interface PromptFeatureInfo {
  key: string;
  label: string;
  description: string;
  defaultPrompt: string;
  /** Profile-aware effective prompt (profile prompt or default) */
  effectivePrompt?: string;
}

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

          {isLoading && (
            <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Waiting for LLM response...</span>
            </div>
          )}

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
  const deleteSetting = useDeleteSetting();
  const [keysToDelete, setKeysToDelete] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<{ data: PromptExportData; preview: ImportPreviewResponse } | null>(null);
  const importApply = useImportApply();

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
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    setProfileRefreshKey((k) => k + 1);
  }, [queryClient]);

  useEffect(() => {
    if (features.length === 0) return;
    const drafts: Record<string, string> = {};
    for (const f of features) {
      const promptKey = `prompts.${f.key}.system_prompt`;
      const modelKey = `prompts.${f.key}.model`;
      const tempKey = `prompts.${f.key}.temperature`;
      // Use profile-aware effective prompt as fallback (includes profile's custom prompt)
      drafts[promptKey] = values[promptKey] || f.effectivePrompt || f.defaultPrompt;
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
    // Mark keys for deletion so profile fallback works correctly
    setKeysToDelete((prev) => new Set([...prev, promptKey, modelKey, tempKey]));
    setDraftValues((prev) => ({
      ...prev,
      [promptKey]: feature.effectivePrompt || feature.defaultPrompt,
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
    const effectiveDefault = feature.effectivePrompt || feature.defaultPrompt;
    const storedPrompt = values[promptKey] || effectiveDefault;
    return storedPrompt !== effectiveDefault || (values[modelKey] || '') !== '' || (values[tempKey] || '') !== '';
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    const changedKeys = Object.keys(draftValues).filter((k) => draftValues[k] !== savedValues[k]);
    try {
      for (const key of changedKeys) {
        if (keysToDelete.has(key)) {
          // Delete the setting so profile fallback can take effect
          await deleteSetting.mutateAsync({ key, showToast: false });
          onChange(key, '');
        } else {
          await updateSetting.mutateAsync({
            key,
            value: draftValues[key],
            category: 'prompts',
            showToast: false,
          });
          onChange(key, draftValues[key]);
        }
      }
      setSavedValues({ ...draftValues });
      setKeysToDelete(new Set());
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
    setKeysToDelete(new Set());
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
      <ProfileSelector
        onProfileSwitch={handleProfileSwitch}
        onImportPreview={(data, preview) => setImportPreviewData({ data, preview })}
      />

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

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium">System Prompt</label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => resetToDefault(feature.key)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset to Default
                      </button>
                      <TokenBadge count={tokenCount} />
                    </div>
                  </div>
                  <textarea
                    value={promptValue}
                    onChange={(e) => handleDraftChange(promptKey, e.target.value)}
                    className="min-h-[160px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Enter system prompt..."
                  />
                </div>

                <PromptTestPanel
                  feature={feature.key}
                  systemPrompt={promptValue}
                  model={modelValue}
                  temperature={tempValue}
                />
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
