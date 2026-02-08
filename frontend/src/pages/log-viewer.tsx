import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Download, WrapText, Activity, ArrowDown } from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { api } from '@/lib/api';
import { ContainerMultiSelect } from '@/components/shared/container-multi-select';
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

function colorizeLogMessage(message: string): ReactNode[] {
  const tokenRe = /(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|PANIC|\b[\w.-]+\.(?:ts|tsx|js|jsx|css|json|sh)\b|\/[^\s,]+)/gi;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(message)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    if (start > cursor) parts.push(message.slice(cursor, start));

    const lowered = token.toLowerCase();
    let className = 'text-slate-100';
    if (/(error|fatal|panic)/.test(lowered)) className = 'text-rose-300';
    else if (/warn/.test(lowered)) className = 'text-amber-300';
    else if (/info/.test(lowered)) className = 'text-emerald-300';
    else if (/(debug|trace)/.test(lowered)) className = 'text-sky-300';
    else if (token.startsWith('/')) className = 'text-cyan-300';
    else className = 'text-violet-300';

    parts.push(
      <span key={`${start}-${token}`} className={className}>
        {token}
      </span>,
    );
    cursor = end;
  }

  if (cursor < message.length) parts.push(message.slice(cursor));
  return parts;
}

function renderLogMessage(message: string, regex: RegExp | null): ReactNode {
  if (regex) return highlightLine(message, regex);
  return colorizeLogMessage(message);
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
    <section className="relative z-10 overflow-hidden rounded-xl border bg-slate-950">
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
                  <span>{renderLogMessage(entry.message, regex)}</span>
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

  const { data: endpoints = [] } = useEndpoints();
  const { data: containers = [] } = useContainers(selectedEndpoint);

  useEffect(() => {
    if (endpoints.length > 0 && !selectedEndpoint) {
      setSelectedEndpoint(endpoints[0].id);
    }
  }, [endpoints, selectedEndpoint]);

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Viewer</h1>
        <p className="text-muted-foreground">Live tail, regex search, level filtering, and multi-container aggregation.</p>
      </div>

      <section className="relative z-20 rounded-xl border bg-card/75 p-4 backdrop-blur">
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
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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

        <div className="relative z-20 mt-3">
          <span className="mb-1 block text-sm text-muted-foreground">Containers</span>
          <ContainerMultiSelect
            containers={containers}
            selected={selectedContainers}
            onChange={setSelectedContainers}
          />
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
