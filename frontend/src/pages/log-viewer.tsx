import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Search, Download, WrapText, Activity, ArrowDown } from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { api } from '@/lib/api';
import { buildRegex, parseLogs, sortByTimestamp, toLocalTimestamp, type LogLevel } from '@/lib/log-viewer';

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

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filteredEntries, autoScroll]);

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Viewer</h1>
        <p className="text-muted-foreground">Live tail, regex search, level filtering, and multi-container aggregation.</p>
      </div>

      <section className="rounded-xl border bg-card/75 p-4 backdrop-blur">
        <div className="grid gap-3 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Endpoint</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2"
              value={selectedEndpoint ?? ''}
              onChange={(e) => setSelectedEndpoint(Number(e.target.value))}
            >
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>
              ))}
            </select>
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
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2"
              value={level}
              onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
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
          <label className="ml-auto text-sm">
            <span className="mr-2 text-muted-foreground">Buffer</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2"
              value={bufferSize}
              onChange={(e) => setBufferSize(Number(e.target.value))}
            >
              {BUFFER_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {filteredEntries.length} lines | {regexMatches} regex matches
        </div>
      </section>

      <section className="relative overflow-hidden rounded-xl border bg-slate-950">
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
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
          onScroll={(e) => {
            const target = e.currentTarget;
            const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 16;
            if (!nearBottom && autoScroll) setAutoScroll(false);
            if (nearBottom && !autoScroll) setAutoScroll(true);
          }}
        >
          {isLoading && <div className="p-3 text-slate-200">Loading logs...</div>}
          {!isLoading && filteredEntries.length === 0 && (
            <div className="p-3 text-slate-200">Select one or more containers to view aggregated logs.</div>
          )}

          {filteredEntries.map((entry, index) => (
            <div
              key={`${entry.id}-${index}`}
              className={`grid grid-cols-[170px_180px_70px_1fr] gap-3 border-b border-slate-800/70 px-3 py-1 text-slate-100 ${lineWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'}`}
            >
              <span className="text-slate-500">{toLocalTimestamp(entry.timestamp)}</span>
              <span className={CONTAINER_COLORS[index % CONTAINER_COLORS.length]}>
                [{entry.containerName}]
              </span>
              <span className={entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-400' : entry.level === 'debug' ? 'text-sky-300' : 'text-emerald-300'}>
                {entry.level.toUpperCase()}
              </span>
              <span>{highlightLine(entry.raw, regex)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
