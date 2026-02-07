import { useState, useMemo } from 'react';
import {
  Search,
  Clock,
  AlertTriangle,
  Info,
  FileText,
  Server,
  RefreshCw,
  Download,
  Filter,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Settings,
  Loader2,
  XCircle,
  AlertCircle,
  CheckCircle2,
  Terminal,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn, formatDate } from '@/lib/utils';
import { ThemedSelect } from '@/components/shared/themed-select';

// Log levels with colors
const LOG_LEVELS = [
  { value: '', label: 'All Levels', color: 'text-muted-foreground' },
  { value: 'error', label: 'Error', color: 'text-red-500' },
  { value: 'warn', label: 'Warning', color: 'text-amber-500' },
  { value: 'info', label: 'Info', color: 'text-blue-500' },
  { value: 'debug', label: 'Debug', color: 'text-emerald-500' },
] as const;

// Time range options
const TIME_RANGES = [
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '4h', label: 'Last 4 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom range' },
] as const;

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  hostname: string;
  level: string;
  source: Record<string, unknown>;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
}

function getTimeRange(range: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();

  const durations: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  const duration = durations[range] || durations['1h'];
  const from = new Date(now.getTime() - duration).toISOString();

  return { from, to };
}

function getLevelIcon(level: string) {
  switch (level?.toLowerCase()) {
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'warn':
    case 'warning':
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
    case 'info':
      return <Info className="h-4 w-4 text-blue-500" />;
    case 'debug':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
  }
}

function getLevelColor(level: string) {
  switch (level?.toLowerCase()) {
    case 'error':
      return 'text-red-500 bg-red-500/10';
    case 'warn':
    case 'warning':
      return 'text-amber-500 bg-amber-500/10';
    case 'info':
      return 'text-blue-500 bg-blue-500/10';
    case 'debug':
      return 'text-emerald-500 bg-emerald-500/10';
    default:
      return 'text-muted-foreground bg-muted';
  }
}

interface LogRowProps {
  log: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function LogRow({ log, isExpanded, onToggle }: LogRowProps) {
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="mt-0.5">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="mt-0.5">{getLevelIcon(log.level)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">
              {formatDate(log.timestamp)}
            </span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium uppercase', getLevelColor(log.level))}>
              {log.level || 'unknown'}
            </span>
            {log.hostname && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Server className="h-3 w-3" />
                {log.hostname}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-mono break-all line-clamp-2">
            {log.message || 'No message'}
          </p>
        </div>
      </button>

      {isExpanded && (
        <div className="px-10 pb-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Full Log Entry</h4>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all overflow-x-auto">
              {JSON.stringify(log.source, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function NotConfiguredState() {
  return (
    <div className="rounded-lg border bg-card p-8">
      <div className="flex flex-col items-center text-center max-w-md mx-auto">
        <div className="rounded-full bg-amber-500/10 p-4 mb-4">
          <Settings className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Elasticsearch Not Configured</h2>
        <p className="text-muted-foreground mb-6">
          Edge Agent Logs require an Elasticsearch or Kibana connection to search and display logs.
        </p>

        <div className="w-full rounded-lg bg-muted/50 p-4 text-left mb-6">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            Quick Setup
          </h3>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-medium text-foreground">1.</span>
              <span>Go to Settings and scroll to the "Elasticsearch / Kibana" section.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-foreground">2.</span>
              <span>Enable Elasticsearch and enter your cluster URL and API key.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-foreground">3.</span>
              <span>Save and return to this page to start searching logs.</span>
            </li>
          </ol>
        </div>

        <a
          href="/settings"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Settings className="h-4 w-4" />
          Configure Elasticsearch
        </a>

        <a
          href="https://www.elastic.co/guide/en/elasticsearch/reference/current/security-api-create-api-key.html"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 text-sm text-primary hover:underline flex items-center gap-1"
        >
          Learn how to create an Elasticsearch API key
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export default function EdgeAgentLogsPage() {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState('1h');
  const [levelFilter, setLevelFilter] = useState('');
  const [hostnameFilter, setHostnameFilter] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const { interval, setInterval } = useAutoRefresh(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Calculate time range
  const { from, to } = useMemo(() => getTimeRange(timeRange), [timeRange, refreshKey]);

  // Fetch logs
  const {
    data: logsData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<LogsResponse>({
    queryKey: ['edge-agent-logs', searchQuery, from, to, levelFilter, hostnameFilter, refreshKey],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        limit: 200,
      };
      if (searchQuery) params.query = searchQuery;
      if (from) params.from = from;
      if (to) params.to = to;
      if (levelFilter) params.level = levelFilter;
      if (hostnameFilter) params.hostname = hostnameFilter;

      return api.get<LogsResponse>('/api/logs/search', { params });
    },
    retry: false, // Don't retry on 503 (not configured)
  });

  // Check if not configured (503 error)
  const isNotConfigured = isError && (error as Error)?.message?.includes('503');

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
  };

  // Handle log expansion
  const toggleLogExpanded = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Handle refresh
  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    refetch();
  };

  // Export logs
  const handleExport = () => {
    if (!logsData?.logs) return;

    const csv = [
      ['Timestamp', 'Level', 'Hostname', 'Message'].join(','),
      ...logsData.logs.map((log) =>
        [
          log.timestamp,
          log.level,
          log.hostname,
          `"${(log.message || '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edge-agent-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Get logs from response
  const logs = useMemo(() => {
    if (!logsData) return [];
    // Handle both { logs: [...] } and array formats
    if (Array.isArray(logsData)) return logsData;
    if (Array.isArray(logsData.logs)) return logsData.logs;
    return [];
  }, [logsData]);

  // Get unique hostnames for filter
  const hostnames = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((log) => {
      if (log.hostname) set.add(log.hostname);
    });
    return Array.from(set).sort();
  }, [logs]);

  // Stats
  const stats = useMemo(() => {
    const byLevel: Record<string, number> = {};
    logs.forEach((log) => {
      const level = log.level?.toLowerCase() || 'unknown';
      byLevel[level] = (byLevel[level] || 0) + 1;
    });
    return byLevel;
  }, [logs]);

  // Not configured state
  if (isNotConfigured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edge Agent Logs</h1>
          <p className="text-muted-foreground">
            Search and analyze logs from edge agents via Elasticsearch
          </p>
        </div>
        <NotConfiguredState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edge Agent Logs</h1>
          <p className="text-muted-foreground">
            Search and analyze logs from edge agents via Elasticsearch
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={handleRefresh} isLoading={isFetching} />
        </div>
      </div>

      {/* Search and Filters */}
      <div className="rounded-lg border bg-card p-4">
        <form onSubmit={handleSearch} className="flex gap-3 flex-wrap">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs... (e.g., error OR timeout)"
              className="w-full h-10 pl-10 pr-4 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Time Range */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={timeRange}
              onValueChange={(val) => setTimeRange(val)}
              options={TIME_RANGES.map((range) => ({ value: range.value, label: range.label }))}
              className="h-10 text-sm"
            />
          </div>

          {/* Level Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={levelFilter || '__all__'}
              onValueChange={(val) => setLevelFilter(val === '__all__' ? '' : val)}
              options={LOG_LEVELS.map((level) => ({
                value: level.value || '__all__',
                label: level.label,
              }))}
              className="h-10 text-sm"
            />
          </div>

          {/* Hostname Filter */}
          {hostnames.length > 0 && (
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <ThemedSelect
                value={hostnameFilter || '__all__'}
                onValueChange={(val) => setHostnameFilter(val === '__all__' ? '' : val)}
                options={[
                  { value: '__all__', label: 'All Hosts' },
                  ...hostnames.map((host) => ({ value: host, label: host })),
                ]}
                className="h-10 text-sm"
              />
            </div>
          )}

          {/* Search Button */}
          <button
            type="submit"
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Search
          </button>

          {/* Export Button */}
          {logs.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="h-10 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
        </form>
      </div>

      {/* Stats Cards */}
      {logs.length > 0 && (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Logs</p>
            <p className="text-2xl font-bold">{logsData?.total || logs.length}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <XCircle className="h-3 w-3 text-red-500" /> Errors
            </p>
            <p className="text-2xl font-bold text-red-500">{stats.error || 0}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-amber-500" /> Warnings
            </p>
            <p className="text-2xl font-bold text-amber-500">{(stats.warn || 0) + (stats.warning || 0)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-500" /> Info
            </p>
            <p className="text-2xl font-bold text-blue-500">{stats.info || 0}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Debug
            </p>
            <p className="text-2xl font-bold text-emerald-500">{stats.debug || 0}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Error State (not including "not configured") */}
      {isError && !isNotConfigured && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="font-semibold">Failed to fetch logs</h3>
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
      )}

      {/* Empty State */}
      {!isLoading && !isError && logs.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No logs found</h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery
              ? 'Try adjusting your search query or filters'
              : 'Enter a search query to find logs'}
          </p>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-2">Search tips:</p>
            <ul className="space-y-1">
              <li>Use <code className="bg-muted px-1 rounded">error</code> to find error messages</li>
              <li>Use <code className="bg-muted px-1 rounded">error OR timeout</code> for multiple terms</li>
              <li>Use <code className="bg-muted px-1 rounded">"exact phrase"</code> for exact matches</li>
            </ul>
          </div>
        </div>
      )}

      {/* Results Table */}
      {!isLoading && !isError && logs.length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="border-b border-border p-4 flex items-center justify-between">
            <h3 className="font-semibold">
              Log Results
              <span className="text-muted-foreground font-normal ml-2">
                ({logs.length} of {logsData?.total || logs.length})
              </span>
            </h3>
            {isFetching && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {logs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                isExpanded={expandedLogs.has(log.id)}
                onToggle={() => toggleLogExpanded(log.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
