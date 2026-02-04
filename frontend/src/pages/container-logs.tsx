import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, ScrollText, Clock, Search } from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { useContainerLogs } from '@/hooks/use-container-logs';
import { SkeletonCard } from '@/components/shared/skeleton-card';
import { RefreshButton } from '@/components/shared/refresh-button';

type TailCount = 100 | 500 | 1000 | -1;

export default function ContainerLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const logViewerRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [tailCount, setTailCount] = useState<TailCount>(100);

  // URL state management for endpoint
  const endpointParam = searchParams.get('endpoint');
  const containerParam = searchParams.get('container');
  const selectedEndpoint = endpointParam ? Number(endpointParam) : undefined;
  const selectedContainer = containerParam || undefined;

  const setSelectedEndpoint = (endpointId: number | undefined) => {
    const params: Record<string, string> = {};
    if (endpointId !== undefined) {
      params.endpoint = String(endpointId);
    }
    setSearchParams(params);
  };

  const setSelectedContainer = (containerId: string | undefined) => {
    const params: Record<string, string> = {};
    if (selectedEndpoint !== undefined) {
      params.endpoint = String(selectedEndpoint);
    }
    if (containerId) {
      params.container = containerId;
    }
    setSearchParams(params);
  };

  // Data fetching
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();
  const { data: containers, isLoading: containersLoading } = useContainers(selectedEndpoint);

  const {
    data: logsData,
    isLoading: logsLoading,
    isError,
    error,
    refetch,
    isFetching
  } = useContainerLogs(selectedEndpoint, selectedContainer, {
    tail: tailCount === -1 ? undefined : tailCount,
    timestamps: showTimestamps,
  });

  // Filter containers list
  const availableContainers = useMemo(() => {
    if (!containers) return [];
    return containers;
  }, [containers]);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && logViewerRef.current) {
      logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
    }
  }, [logsData, autoScroll]);

  // Parse and filter logs
  const displayLogs = useMemo(() => {
    if (!logsData?.logs) return [];

    const lines = logsData.logs.split('\n').filter(line => line.trim());

    if (!searchTerm) return lines;

    const searchLower = searchTerm.toLowerCase();
    return lines.filter(line => line.toLowerCase().includes(searchLower));
  }, [logsData, searchTerm]);

  // Download logs
  const handleDownload = () => {
    if (!logsData?.logs) return;

    const blob = new Blob([logsData.logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${logsData.container}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Error state
  if (isError && selectedEndpoint && selectedContainer) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Logs</h1>
          <p className="text-muted-foreground">
            Docker container log viewer
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load logs</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error?.message || 'An unknown error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
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
          <h1 className="text-3xl font-bold tracking-tight">Container Logs</h1>
          <p className="text-muted-foreground">
            Docker container log viewer
          </p>
        </div>
        <div className="flex items-center gap-2">
          {logsData && (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              title="Download logs"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          )}
          <RefreshButton
            onClick={() => refetch()}
            isLoading={isFetching}
            disabled={!selectedEndpoint || !selectedContainer}
          />
        </div>
      </div>

      {/* Selectors */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Endpoint Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="endpoint-select" className="text-sm font-medium">
            Endpoint
          </label>
          <select
            id="endpoint-select"
            value={selectedEndpoint ?? ''}
            onChange={(e) => setSelectedEndpoint(e.target.value ? Number(e.target.value) : undefined)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={endpointsLoading}
          >
            <option value="">Select an endpoint</option>
            {endpoints?.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name} (ID: {ep.id})
              </option>
            ))}
          </select>
        </div>

        {/* Container Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="container-select" className="text-sm font-medium">
            Container
          </label>
          <select
            id="container-select"
            value={selectedContainer ?? ''}
            onChange={(e) => setSelectedContainer(e.target.value || undefined)}
            className="min-w-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!selectedEndpoint || containersLoading}
          >
            <option value="">Select a container</option>
            {availableContainers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.endpointName})
              </option>
            ))}
          </select>
        </div>

        {/* Tail Count Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="tail-select" className="text-sm font-medium">
            Tail
          </label>
          <select
            id="tail-select"
            value={tailCount}
            onChange={(e) => setTailCount(Number(e.target.value) as TailCount)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!selectedContainer}
          >
            <option value={100}>100 lines</option>
            <option value={500}>500 lines</option>
            <option value={1000}>1000 lines</option>
            <option value={-1}>All lines</option>
          </select>
        </div>
      </div>

      {/* Controls */}
      {selectedContainer && (
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search Input */}
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Auto-scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              autoScroll
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'border-input bg-background hover:bg-accent'
            }`}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          >
            <ScrollText className="h-4 w-4" />
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </button>

          {/* Timestamp Toggle */}
          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              showTimestamps
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-input bg-background hover:bg-accent'
            }`}
            title={showTimestamps ? 'Timestamps shown' : 'Timestamps hidden'}
          >
            <Clock className="h-4 w-4" />
            Timestamps {showTimestamps ? 'ON' : 'OFF'}
          </button>

          {/* Log Summary */}
          {logsData && (
            <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {displayLogs.length} {displayLogs.length === 1 ? 'line' : 'lines'}
                {searchTerm && logsData.logs && ` (filtered from ${logsData.logs.split('\n').filter(l => l.trim()).length})`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Log Viewer */}
      {!selectedEndpoint || !selectedContainer ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <ScrollText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-medium">No container selected</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Select an endpoint and container to view logs
          </p>
        </div>
      ) : logsLoading ? (
        <SkeletonCard className="h-[600px]" />
      ) : displayLogs.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <ScrollText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-medium">
            {searchTerm ? 'No matching logs found' : 'No logs available'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {searchTerm
              ? 'Try adjusting your search term or clear the filter'
              : 'This container has not produced any log output'
            }
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          <div
            ref={logViewerRef}
            className="h-[600px] overflow-auto p-4 bg-slate-950 dark:bg-slate-950"
          >
            <pre className="text-xs text-slate-100 font-mono leading-relaxed">
              {displayLogs.map((line, index) => (
                <div
                  key={index}
                  className={searchTerm && line.toLowerCase().includes(searchTerm.toLowerCase())
                    ? 'bg-yellow-500/20'
                    : undefined
                  }
                >
                  {line}
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
