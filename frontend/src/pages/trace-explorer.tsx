import { useState, useMemo } from 'react';
import {
  Search,
  GitBranch,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Activity,
  Server,
  Filter,
  Layers,
  Timer,
  Tag,
} from 'lucide-react';
import { useTraces, useTrace, useServiceMap, useTraceSummary } from '@/hooks/use-traces';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { ServiceMap } from '@/components/charts/service-map';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn, formatDate } from '@/lib/utils';

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function getDurationColor(ms: number): string {
  if (ms < 100) return 'bg-emerald-500';
  if (ms < 500) return 'bg-blue-500';
  if (ms < 1000) return 'bg-amber-500';
  return 'bg-red-500';
}

interface SpanBarProps {
  span: {
    spanId: string;
    operationName: string;
    serviceName: string;
    startTime: string;
    duration: number;
    status: string;
    parentSpanId?: string;
  };
  traceStartTime: number;
  traceDuration: number;
  depth: number;
  isSelected: boolean;
  onClick: () => void;
}

function SpanBar({ span, traceStartTime, traceDuration, depth, isSelected, onClick }: SpanBarProps) {
  const spanStart = new Date(span.startTime).getTime();
  const offsetPercent = ((spanStart - traceStartTime) / traceDuration) * 100;
  const widthPercent = Math.max((span.duration / traceDuration) * 100, 1);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors',
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
      )}
    >
      <div className="w-32 shrink-0 truncate text-sm" style={{ paddingLeft: depth * 16 }}>
        <span className="font-medium">{span.serviceName}</span>
      </div>
      <div className="w-40 shrink-0 truncate text-xs text-muted-foreground">
        {span.operationName}
      </div>
      <div className="relative h-6 flex-1 rounded bg-muted/30">
        <div
          className={cn(
            'absolute top-1 h-4 rounded transition-all',
            getDurationColor(span.duration),
            span.status === 'error' && 'bg-red-500'
          )}
          style={{
            left: `${offsetPercent}%`,
            width: `${widthPercent}%`,
            minWidth: 4,
          }}
        />
      </div>
      <div className="w-20 shrink-0 text-right text-xs text-muted-foreground">
        {formatDuration(span.duration)}
      </div>
      {span.status === 'error' && (
        <XCircle className="h-4 w-4 shrink-0 text-red-500" />
      )}
    </button>
  );
}

interface TraceListItemProps {
  trace: {
    traceId: string;
    rootSpan: {
      serviceName: string;
      operationName: string;
    };
    duration: number;
    spans: unknown[];
    services: string[];
    startTime: string;
    status: string;
  };
  isSelected: boolean;
  onClick: () => void;
}

function TraceListItem({ trace, isSelected, onClick }: TraceListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-all',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border bg-card hover:border-primary/50'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs">{trace.traceId.slice(0, 16)}</span>
        </div>
        <StatusBadge status={trace.status} showDot={false} />
      </div>
      <div className="mt-2">
        <p className="font-medium">{trace.rootSpan?.serviceName || 'Unknown'}</p>
        <p className="text-sm text-muted-foreground truncate">
          {trace.rootSpan?.operationName || 'Unknown operation'}
        </p>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Timer className="h-3 w-3" />
          {formatDuration(trace.duration)}
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          {trace.spans?.length || 0} spans
        </span>
        <span className="flex items-center gap-1">
          <Server className="h-3 w-3" />
          {trace.services?.length || 0} services
        </span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {formatDate(trace.startTime)}
      </div>
    </button>
  );
}

export default function TraceExplorerPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'error'>('all');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [showServiceMap, setShowServiceMap] = useState(false);
  const { interval, setInterval } = useAutoRefresh(0);

  // Fetch data
  const { data: traces, isLoading, isError, error, refetch, isFetching } = useTraces({
    service: serviceFilter || undefined,
    limit: 50,
  });

  const { data: selectedTrace } = useTrace(selectedTraceId || undefined);
  const { data: serviceMapData } = useServiceMap();
  const { data: summary } = useTraceSummary();

  // Filter traces
  const filteredTraces = useMemo(() => {
    if (!traces) return [];
    return traces.filter((trace) => {
      if (statusFilter !== 'all' && trace.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          trace.traceId.toLowerCase().includes(q) ||
          trace.rootSpan?.serviceName?.toLowerCase().includes(q) ||
          trace.rootSpan?.operationName?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [traces, searchQuery, statusFilter]);

  // Get unique services for filter
  const services = useMemo(() => {
    if (!traces) return [];
    const set = new Set<string>();
    traces.forEach((t) => t.services?.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [traces]);

  // Build span tree for selected trace
  const spanTree = useMemo(() => {
    if (!selectedTrace?.spans) return [];

    const spans = selectedTrace.spans;
    const spanMap = new Map(spans.map((s) => [s.spanId, s]));
    const rootSpans = spans.filter((s) => !s.parentSpanId);

    const buildTree = (span: typeof spans[0], depth: number): Array<{ span: typeof spans[0]; depth: number }> => {
      const result = [{ span, depth }];
      const children = spans.filter((s) => s.parentSpanId === span.spanId);
      children.forEach((child) => {
        result.push(...buildTree(child, depth + 1));
      });
      return result;
    };

    return rootSpans.flatMap((root) => buildTree(root, 0));
  }, [selectedTrace]);

  // Selected span details
  const selectedSpan = useMemo(() => {
    if (!selectedTrace?.spans || !selectedSpanId) return null;
    return selectedTrace.spans.find((s) => s.spanId === selectedSpanId);
  }, [selectedTrace, selectedSpanId]);

  // Service map data transformation
  const serviceMapNodes = useMemo(() => {
    if (!serviceMapData?.nodes) return [];
    return serviceMapData.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      callCount: n.metrics?.requestRate || 0,
      avgDuration: n.metrics?.avgLatency || 0,
      errorRate: n.metrics?.errorRate || 0,
    }));
  }, [serviceMapData]);

  const serviceMapEdges = useMemo(() => {
    if (!serviceMapData?.edges) return [];
    return serviceMapData.edges.map((e) => ({
      source: e.source,
      target: e.target,
      callCount: e.requestRate || 0,
      avgDuration: e.avgLatency || 0,
    }));
  }, [serviceMapData]);

  // Error state
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trace Explorer</h1>
          <p className="text-muted-foreground">
            Distributed trace visualization with service map
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load traces</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
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
          <h1 className="text-3xl font-bold tracking-tight">Trace Explorer</h1>
          <p className="text-muted-foreground">
            Distributed trace visualization with service map
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Traces</p>
            <p className="text-2xl font-bold">{summary.totalTraces}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Avg Duration</p>
            <p className="text-2xl font-bold">{formatDuration(summary.avgDuration)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Error Rate</p>
            <p className="text-2xl font-bold">{(summary.errorRate * 100).toFixed(1)}%</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Services</p>
            <p className="text-2xl font-bold">{summary.services}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search traces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-md border border-input overflow-hidden">
            {(['all', 'ok', 'error'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium transition-colors',
                  statusFilter === status
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                )}
              >
                {status === 'all' ? 'All' : status === 'ok' ? 'Success' : 'Error'}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowServiceMap(!showServiceMap)}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            showServiceMap
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-background hover:bg-muted'
          )}
        >
          <Activity className="h-4 w-4" />
          Service Map
        </button>
      </div>

      {/* Service Map */}
      {showServiceMap && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-4">Service Dependency Map</h3>
          <ServiceMap serviceNodes={serviceMapNodes} serviceEdges={serviceMapEdges} />
        </div>
      )}

      {/* Main Content */}
      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <SkeletonCard className="h-[600px]" />
          <div className="lg:col-span-2">
            <SkeletonCard className="h-[600px]" />
          </div>
        </div>
      ) : filteredTraces.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
          <GitBranch className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No traces found</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {searchQuery || serviceFilter
              ? 'Try adjusting your search or filter criteria.'
              : 'No distributed traces have been collected yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Trace List */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
            {filteredTraces.map((trace) => (
              <TraceListItem
                key={trace.traceId}
                trace={trace}
                isSelected={selectedTraceId === trace.traceId}
                onClick={() => {
                  setSelectedTraceId(trace.traceId);
                  setSelectedSpanId(null);
                }}
              />
            ))}
          </div>

          {/* Trace Detail */}
          <div className="lg:col-span-2">
            {selectedTraceId && selectedTrace ? (
              <div className="rounded-lg border bg-card">
                {/* Trace Header */}
                <div className="border-b p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-primary" />
                      <span className="font-mono text-sm">{selectedTrace.traceId}</span>
                    </div>
                    <StatusBadge status={selectedTrace.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{formatDuration(selectedTrace.duration)}</span>
                    <span>{selectedTrace.spans?.length || 0} spans</span>
                    <span>{selectedTrace.services?.length || 0} services</span>
                    <span>{formatDate(selectedTrace.startTime)}</span>
                  </div>
                </div>

                {/* Span Timeline */}
                <div className="p-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Span Timeline</h4>
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {spanTree.map(({ span, depth }) => (
                      <SpanBar
                        key={span.spanId}
                        span={span}
                        traceStartTime={new Date(selectedTrace.startTime).getTime()}
                        traceDuration={selectedTrace.duration}
                        depth={depth}
                        isSelected={selectedSpanId === span.spanId}
                        onClick={() => setSelectedSpanId(span.spanId)}
                      />
                    ))}
                  </div>
                </div>

                {/* Span Details */}
                {selectedSpan && (
                  <div className="border-t p-4">
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">Span Details</h4>
                    <div className="space-y-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Service</p>
                          <p className="font-medium">{selectedSpan.serviceName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Operation</p>
                          <p className="font-medium">{selectedSpan.operationName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Duration</p>
                          <p className="font-medium">{formatDuration(selectedSpan.duration)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Status</p>
                          <StatusBadge status={selectedSpan.status} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Span ID</p>
                          <p className="font-mono text-xs">{selectedSpan.spanId}</p>
                        </div>
                        {selectedSpan.parentSpanId && (
                          <div>
                            <p className="text-xs text-muted-foreground">Parent Span</p>
                            <p className="font-mono text-xs">{selectedSpan.parentSpanId}</p>
                          </div>
                        )}
                      </div>

                      {selectedSpan.attributes && Object.keys(selectedSpan.attributes).length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-2">Attributes</p>
                          <div className="rounded-md bg-muted/50 p-3 font-mono text-xs">
                            {Object.entries(selectedSpan.attributes).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="text-muted-foreground">{key}:</span>
                                <span>{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-[600px] items-center justify-center rounded-lg border border-dashed bg-muted/20">
                <div className="text-center">
                  <ChevronRight className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Select a trace to view details
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
