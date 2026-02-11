import { useState, useMemo, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, ScrollText, Clock, Search, AlertTriangle, Radio, WifiOff } from 'lucide-react';
import { useContainerLogs, type ContainerLogsError } from '@/hooks/use-container-logs';
import { ThemedSelect } from '@/components/shared/themed-select';
import { SkeletonCard } from '@/components/shared/loading-skeleton';

export type TailCount = 100 | 500 | 1000 | -1;

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | null;

function getLogLevel(line: string): LogLevel {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic') || lower.includes('exception')) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('warning')) {
    return 'warn';
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }
  if (lower.includes('info')) {
    return 'info';
  }
  return null;
}

const LOG_LINE_HEIGHT = 24;

function VirtualizedContainerLogs({
  logViewerRef,
  displayLogs,
  searchTerm,
  autoScroll,
  setAutoScroll,
}: {
  logViewerRef: React.RefObject<HTMLDivElement | null>;
  displayLogs: string[];
  searchTerm: string;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
}) {
  const searchLower = searchTerm.toLowerCase();

  const virtualizer = useVirtualizer({
    count: displayLogs.length,
    getScrollElement: () => logViewerRef.current,
    estimateSize: () => LOG_LINE_HEIGHT,
    overscan: 20,
  });

  useEffect(() => {
    if (autoScroll && displayLogs.length > 0) {
      virtualizer.scrollToIndex(displayLogs.length - 1, { align: 'end' });
    }
  }, [displayLogs.length, autoScroll, virtualizer]);

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div
        ref={logViewerRef}
        className="h-[600px] overflow-auto bg-slate-950 dark:bg-slate-950"
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
          className="text-sm font-mono"
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const line = displayLogs[virtualRow.index];
            const isMatch = searchTerm && line.toLowerCase().includes(searchLower);
            const logLevel = getLogLevel(line);
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
                className={`flex ${isMatch ? 'bg-yellow-500/30' : 'hover:bg-slate-800/50'} ${logLevel === 'error' ? 'text-red-400' : ''} ${logLevel === 'warn' ? 'text-yellow-400' : ''} ${logLevel === 'debug' ? 'text-slate-500' : ''} ${logLevel === 'info' || !logLevel ? 'text-slate-200' : ''}`}
              >
                <span className="select-none px-3 py-0.5 text-right text-slate-600 text-xs w-12 shrink-0">
                  {virtualRow.index + 1}
                </span>
                <span className="px-3 py-0.5 whitespace-pre-wrap break-all leading-relaxed">
                  {line}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EdgeErrorState({ error, onRetry }: { error: ContainerLogsError; onRetry: () => void }) {
  if (error.code === 'EDGE_ASYNC_UNSUPPORTED') {
    return (
      <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-900/20 p-8 text-center">
        <WifiOff className="mx-auto h-10 w-10 text-amber-600 dark:text-amber-400" />
        <p className="mt-4 font-medium text-amber-800 dark:text-amber-200">
          Logs unavailable for Edge Async endpoints
        </p>
        <p className="mt-1 text-sm text-amber-700/80 dark:text-amber-300/80">
          This endpoint uses asynchronous communication without a persistent tunnel.
          Live log streaming is not supported.
        </p>
      </div>
    );
  }

  if (error.code === 'EDGE_TUNNEL_TIMEOUT') {
    return (
      <div className="rounded-lg border border-orange-500/50 bg-orange-50 dark:bg-orange-900/20 p-8 text-center">
        <Radio className="mx-auto h-10 w-10 text-orange-600 dark:text-orange-400" />
        <p className="mt-4 font-medium text-orange-800 dark:text-orange-200">
          Edge agent tunnel timed out
        </p>
        <p className="mt-1 text-sm text-orange-700/80 dark:text-orange-300/80">
          The Edge agent tunnel could not be established within the timeout period.
          The agent may be offline or experiencing connectivity issues.
        </p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-orange-300 dark:border-orange-600 bg-white dark:bg-orange-900/40 px-3 py-2 text-sm font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/60"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
      <p className="mt-4 font-medium text-destructive">Failed to load logs</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {error.message || 'An unknown error occurred'}
      </p>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        Try again
      </button>
    </div>
  );
}

interface ContainerLogsViewerProps {
  endpointId: number;
  containerId: string;
  initialTailCount?: TailCount;
  showControls?: boolean;
}

export function ContainerLogsViewer({
  endpointId,
  containerId,
  initialTailCount = 100,
  showControls = true,
}: ContainerLogsViewerProps) {
  const logViewerRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [tailCount, setTailCount] = useState<TailCount>(initialTailCount);

  const {
    data: logsData,
    isLoading: logsLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useContainerLogs(endpointId, containerId, {
    tail: tailCount === -1 ? undefined : tailCount,
    timestamps: showTimestamps,
  });

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

  // Error state — delegate to Edge-specific component
  if (isError && error) {
    return <EdgeErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      {showControls && (
        <div className="flex items-center gap-4 flex-wrap">
          {/* Tail Count Selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">
              Tail
            </label>
            <ThemedSelect
              value={String(tailCount)}
              onValueChange={(val) => setTailCount(Number(val) as TailCount)}
              options={[
                { value: '100', label: '100 lines' },
                { value: '500', label: '500 lines' },
                { value: '1000', label: '1000 lines' },
                { value: '-1', label: 'All lines' },
              ]}
            />
          </div>

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

          {/* Download Button */}
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
      {logsLoading ? (
        <div className="relative">
          <SkeletonCard className="h-[600px]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Radio className="h-8 w-8 text-muted-foreground animate-pulse" />
            <p className="mt-2 text-sm text-muted-foreground">Loading logs...</p>
          </div>
        </div>
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
        <VirtualizedContainerLogs
          logViewerRef={logViewerRef}
          displayLogs={displayLogs}
          searchTerm={searchTerm}
          autoScroll={autoScroll}
          setAutoScroll={setAutoScroll}
        />
      )}
    </div>
  );
}
