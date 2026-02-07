import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Download, WrapText, Activity, ArrowDown, Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { api } from '@/lib/api';
import { buildRegex, parseLogs, sortByTimestamp, toLocalTimestamp, type LogLevel, type ParsedLogEntry } from '@/lib/log-viewer';
import { ThemedSelect } from '@/components/shared/themed-select';

const BUFFER_OPTIONS = [500, 1000, 2000] as const;
const LEVEL_OPTIONS: Array<{ value: LogLevel | 'all'; label: string }> = [
  { value: 'all', label: 'All Levels' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];
const CONTAINER_COLORS = ['text-cyan-300', 'text-emerald-300', 'text-yellow-300', 'text-fuchsia-300', 'text-blue-300'];

interface LogsResponse {
  logs: string;
}

interface SettingRow {
  key: string;
  value: string;
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

interface LogsSettingsFormState {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  indexPattern: string;
  verifySsl: boolean;
}

function highlightLine(line: string, regex: RegExp | null): ReactNode {
  if (!regex) return line;
  const matches = [...line.matchAll(regex)];
  if (matches.length === 0) return line;

  const parts: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, idx) => {
    if (match.index === undefined) return;
    const start = match.index;
    const end = start + match[0].length;
    if (start > cursor) parts.push(line.slice(cursor, start));
    parts.push(
      <mark key={`${start}-${idx}`} className="bg-yellow-300/40 text-yellow-100">
        {line.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

const LOG_ROW_HEIGHT = 28;

function VirtualizedLogView({
  scrollRef,
  filteredEntries,
  isLoading,
  autoScroll,
  setAutoScroll,
  lineWrap,
  regex,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  filteredEntries: ParsedLogEntry[];
  isLoading: boolean;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  lineWrap: boolean;
  regex: RegExp | null;
}) {
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 20,
  });

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && filteredEntries.length > 0) {
      virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
    }
  }, [filteredEntries.length, autoScroll, virtualizer]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 16;
      if (!nearBottom && autoScroll) setAutoScroll(false);
      if (nearBottom && !autoScroll) setAutoScroll(true);
    },
    [autoScroll, setAutoScroll],
  );

  return (
    <section className="relative overflow-hidden rounded-xl border bg-slate-950">
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
          }}
          className="absolute bottom-3 right-3 z-10 rounded-full border border-border bg-background px-3 py-1 text-xs"
        >
          <ArrowDown className="mr-1 inline h-3 w-3" />
          Jump To Bottom
        </button>
      )}
      <div
        ref={scrollRef}
        className="h-[640px] overflow-auto font-mono text-sm"
        onScroll={handleScroll}
      >
        {isLoading && <div className="p-3 text-slate-200">Loading logs...</div>}
        {!isLoading && filteredEntries.length === 0 && (
          <div className="p-3 text-slate-200">Select one or more containers to view aggregated logs.</div>
        )}

        {filteredEntries.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`grid grid-cols-[170px_180px_70px_1fr] gap-3 border-b border-slate-800/70 px-3 py-1 text-slate-100 ${lineWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'}`}
                >
                  <span className="text-slate-500">{toLocalTimestamp(entry.timestamp)}</span>
                  <span className={CONTAINER_COLORS[virtualRow.index % CONTAINER_COLORS.length]}>
                    [{entry.containerName}]
                  </span>
                  <span className={entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-400' : entry.level === 'debug' ? 'text-sky-300' : 'text-emerald-300'}>
                    {entry.level.toUpperCase()}
                  </span>
                  <span>{highlightLine(entry.raw, regex)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default function LogViewerPage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>();
  const [selectedContainers, setSelectedContainers] = useState<string[]>([]);
  const [searchPattern, setSearchPattern] = useState('');
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [bufferSize, setBufferSize] = useState<number>(1000);
  const [lineWrap, setLineWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveTail, setLiveTail] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null);
  const [logsConfigStatus, setLogsConfigStatus] = useState<LogsConfigResponse | null>(null);
  const [settingsForm, setSettingsForm] = useState<LogsSettingsFormState>({
    enabled: false,
    endpoint: '',
    apiKey: '',
    indexPattern: 'logs-*',
    verifySsl: true,
  });

  const { data: endpoints = [] } = useEndpoints();
  const { data: containers = [] } = useContainers(selectedEndpoint);

  const endpointValidationError = useMemo(() => {
    if (!settingsForm.endpoint.trim()) return 'Endpoint is required.';
    try {
      const parsed = new URL(settingsForm.endpoint);
      if (!/^https?:$/.test(parsed.protocol)) {
        return 'Endpoint must start with http:// or https://';
      }
      return null;
    } catch {
      return 'Enter a valid URL (for example: https://logs.internal:9200)';
    }
  }, [settingsForm.endpoint]);

  useEffect(() => {
    if (endpoints.length > 0 && !selectedEndpoint) {
      setSelectedEndpoint(endpoints[0].id);
    }
  }, [endpoints, selectedEndpoint]);

  useEffect(() => {
    let active = true;

    const loadLogsSettings = async () => {
      setSettingsLoading(true);
      setSettingsError(null);
      try {
        const [settingsPayload, configPayload] = await Promise.all([
          api.get<SettingRow[] | { settings?: SettingRow[] }>('/api/settings', {
            params: { category: 'elasticsearch' },
          }),
          api.get<LogsConfigResponse>('/api/logs/config'),
        ]);

        if (!active) return;

        const settingsRows = Array.isArray(settingsPayload)
          ? settingsPayload
          : settingsPayload.settings ?? [];
        const byKey = settingsRows.reduce<Record<string, string>>((acc, row) => {
          acc[row.key] = row.value;
          return acc;
        }, {});

        setSettingsForm({
          enabled: byKey['elasticsearch.enabled'] === 'true',
          endpoint: byKey['elasticsearch.endpoint'] ?? configPayload.endpoint ?? '',
          apiKey: byKey['elasticsearch.api_key'] ?? '',
          indexPattern: byKey['elasticsearch.index_pattern'] ?? configPayload.indexPattern ?? 'logs-*',
          verifySsl: byKey['elasticsearch.verify_ssl'] !== 'false',
        });
        setLogsConfigStatus(configPayload);
      } catch (err) {
        if (!active) return;
        setSettingsError(err instanceof Error ? err.message : 'Failed to load log settings');
      } finally {
        if (active) {
          setSettingsLoading(false);
        }
      }
    };

    void loadLogsSettings();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSelectedContainers([]);
  }, [selectedEndpoint]);

  const selectedContainerModels = useMemo(
    () => containers.filter((container) => selectedContainers.includes(container.id)),
    [containers, selectedContainers],
  );

  const containerQueries = useQueries({
    queries: selectedContainerModels.map((container) => ({
      queryKey: ['log-viewer', container.endpointId, container.id, bufferSize],
      queryFn: () => api.get<LogsResponse>(`/api/containers/${container.endpointId}/${container.id}/logs`, {
        params: { tail: bufferSize, timestamps: true },
      }),
      refetchInterval: liveTail ? 2000 : false,
      enabled: true,
    })),
  });

  const regex = useMemo(() => buildRegex(searchPattern), [searchPattern]);

  const mergedEntries = useMemo(() => {
    const parsed = containerQueries.flatMap((query, idx) => {
      const container = selectedContainerModels[idx];
      if (!container || !query.data?.logs) return [];
      return parseLogs({
        containerId: container.id,
        containerName: container.name,
        logs: query.data.logs,
      });
    });
    return sortByTimestamp(parsed).slice(-bufferSize);
  }, [containerQueries, selectedContainerModels, bufferSize]);

  const filteredEntries = useMemo(() => {
    return mergedEntries.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false;
      if (!regex) return true;
      return entry.raw.match(regex) !== null;
    });
  }, [mergedEntries, level, regex]);

  const regexMatches = useMemo(() => {
    if (!regex) return 0;
    return filteredEntries.reduce((count, entry) => count + (entry.raw.match(regex)?.length || 0), 0);
  }, [filteredEntries, regex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        setSearchPattern('');
      } else if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
        setAutoScroll(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleContainer = (containerId: string) => {
    setSelectedContainers((prev) => (
      prev.includes(containerId)
        ? prev.filter((id) => id !== containerId)
        : [...prev, containerId]
    ));
  };

  const exportLogs = (kind: 'log' | 'json') => {
    const filenameTime = new Date().toISOString().replace(/[:.]/g, '-');
    const payload = kind === 'json'
      ? JSON.stringify(filteredEntries, null, 2)
      : filteredEntries.map((entry) => `${toLocalTimestamp(entry.timestamp)} [${entry.containerName}] ${entry.level.toUpperCase()} ${entry.message}`).join('\n');
    const blob = new Blob([payload], { type: kind === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aggregated-logs-${filenameTime}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLoading = containerQueries.some((q) => q.isLoading);

  const updateSettingField = <K extends keyof LogsSettingsFormState>(key: K, value: LogsSettingsFormState[K]) => {
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
    setSettingsSaved(false);
  };

  const saveLogSettings = async () => {
    if (endpointValidationError) return;

    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const updates: Array<[string, string]> = [
        ['elasticsearch.enabled', String(settingsForm.enabled)],
        ['elasticsearch.endpoint', settingsForm.endpoint.trim()],
        ['elasticsearch.api_key', settingsForm.apiKey.trim()],
        ['elasticsearch.index_pattern', settingsForm.indexPattern.trim() || 'logs-*'],
        ['elasticsearch.verify_ssl', String(settingsForm.verifySsl)],
      ];

      for (const [key, value] of updates) {
        await api.put(`/api/settings/${key}`, { value });
      }

      const configPayload = await api.get<LogsConfigResponse>('/api/logs/config');
      setLogsConfigStatus(configPayload);
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save log settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const testConnection = async () => {
    if (endpointValidationError) return;

    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await api.post<TestConnectionResponse>('/api/logs/test-connection', {
        endpoint: settingsForm.endpoint.trim(),
        apiKey: settingsForm.apiKey.trim() || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Viewer</h1>
        <p className="text-muted-foreground">Live tail, regex search, level filtering, and multi-container aggregation.</p>
      </div>

      <section className="rounded-xl border bg-card/75 p-4 backdrop-blur">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Logs Settings</h2>
            <p className="text-sm text-muted-foreground">Configure Elasticsearch source and validate connection.</p>
          </div>
          {logsConfigStatus && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${logsConfigStatus.configured ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
              {logsConfigStatus.configured ? 'Configured' : 'Not configured'}
            </span>
          )}
        </div>

        {settingsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading log settings...
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Elasticsearch Endpoint</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                value={settingsForm.endpoint}
                onChange={(e) => updateSettingField('endpoint', e.target.value)}
                placeholder="https://logs.internal:9200"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Index Pattern</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                value={settingsForm.indexPattern}
                onChange={(e) => updateSettingField('indexPattern', e.target.value)}
                placeholder="logs-*"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">API Key (optional)</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                type="password"
                value={settingsForm.apiKey}
                onChange={(e) => updateSettingField('apiKey', e.target.value)}
                placeholder="Api key"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settingsForm.enabled}
                  onChange={(e) => updateSettingField('enabled', e.target.checked)}
                />
                Enable Elasticsearch logs
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settingsForm.verifySsl}
                  onChange={(e) => updateSettingField('verifySsl', e.target.checked)}
                />
                Verify SSL
              </label>
            </div>
          </div>
        )}

        {endpointValidationError && !settingsLoading && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{endpointValidationError}</p>
        )}

        {settingsError && (
          <p className="mt-2 text-xs text-destructive">{settingsError}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={testConnection}
            disabled={settingsLoading || settingsSaving || testLoading || !!endpointValidationError}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {testLoading ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            onClick={saveLogSettings}
            disabled={settingsLoading || settingsSaving || !!endpointValidationError}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Settings
          </button>
          {settingsSaved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>

        {testResult && (
          <div className={`mt-3 rounded-md border p-3 text-sm ${testResult.success ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'}`}>
            <div className="flex items-center gap-1">
              {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
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
      </section>

      <section className="rounded-xl border bg-card/75 p-4 backdrop-blur">
        <div className="grid gap-3 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Endpoint</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedEndpoint != null ? String(selectedEndpoint) : '__all__'}
              onValueChange={(val) => setSelectedEndpoint(val === '__all__' ? undefined : Number(val))}
              placeholder="Select endpoint..."
              options={[
                ...endpoints.map((endpoint) => ({ value: String(endpoint.id), label: endpoint.name })),
              ]}
            />
          </label>

          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block text-muted-foreground">Regex Search</span>
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={searchInputRef}
                className="h-full w-full bg-transparent outline-none"
                placeholder="/error|timeout/i"
                value={searchPattern}
                onChange={(e) => setSearchPattern(e.target.value)}
              />
            </div>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Level</span>
            <ThemedSelect
              className="h-9 w-full"
              value={level}
              onValueChange={(val) => setLevel(val as LogLevel | 'all')}
              options={LEVEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {containers.map((container, idx) => {
            const selected = selectedContainers.includes(container.id);
            return (
              <button
                key={container.id}
                onClick={() => toggleContainer(container.id)}
                className={`rounded-full border px-3 py-1 text-xs ${selected ? 'border-primary bg-primary/15' : 'border-border bg-background'}`}
              >
                <span className={CONTAINER_COLORS[idx % CONTAINER_COLORS.length]}>{container.name}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <button onClick={() => setLiveTail((v) => !v)} className="rounded-md border px-2 py-1">
            <Activity className="mr-1 inline h-4 w-4" />
            Live Tail {liveTail ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setLineWrap((v) => !v)} className="rounded-md border px-2 py-1">
            <WrapText className="mr-1 inline h-4 w-4" />
            Wrap {lineWrap ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => exportLogs('log')} className="rounded-md border px-2 py-1">
            <Download className="mr-1 inline h-4 w-4" />
            Export .log
          </button>
          <button onClick={() => exportLogs('json')} className="rounded-md border px-2 py-1">
            <Download className="mr-1 inline h-4 w-4" />
            Export .json
          </button>
          <label className="ml-auto inline-flex items-center text-sm">
            <span className="mr-2 text-muted-foreground">Buffer</span>
            <ThemedSelect
              className="h-8"
              value={String(bufferSize)}
              onValueChange={(val) => setBufferSize(Number(val))}
              options={BUFFER_OPTIONS.map((size) => ({ value: String(size), label: String(size) }))}
            />
          </label>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {filteredEntries.length} lines | {regexMatches} regex matches
        </div>
      </section>

      <VirtualizedLogView
        scrollRef={scrollRef}
        filteredEntries={filteredEntries}
        isLoading={isLoading}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        lineWrap={lineWrap}
        regex={regex}
      />
    </div>
  );
}
