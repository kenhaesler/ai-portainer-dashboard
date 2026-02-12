import { useState, useMemo } from 'react';
import {
  Search,
  GitBranch,
  AlertTriangle,
  XCircle,
  ChevronRight,
  Activity,
  Server,
  Filter,
  Layers,
  Timer,
} from 'lucide-react';
import { useTraces, useTrace, useServiceMap, useTraceSummary } from '@/hooks/use-traces';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { ServiceMap } from '@/components/charts/service-map';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn, formatDate } from '@/lib/utils';
import { ThemedSelect } from '@/components/shared/themed-select';

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

function getFromIso(timeRange: string): string | undefined {
  if (timeRange === 'all') return undefined;
  const now = Date.now();
  const map: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  const delta = map[timeRange];
  if (!delta) return undefined;
  return new Date(now - delta).toISOString();
}

function parseAttributes(attributes: unknown): Record<string, unknown> {
  if (!attributes) return {};
  if (typeof attributes === 'string') {
    try {
      const parsed = JSON.parse(attributes) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (typeof attributes === 'object') return attributes as Record<string, unknown>;
  return {};
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
  const safeTraceDuration = Math.max(traceDuration, 1);
  const offsetPercent = ((spanStart - traceStartTime) / safeTraceDuration) * 100;
  const widthPercent = Math.max((span.duration / safeTraceDuration) * 100, 1);

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
            left: `${Math.max(offsetPercent, 0)}%`,
            width: `${Math.min(widthPercent, 100)}%`,
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
    trace_id?: string;
    traceId?: string;
    root_span?: string;
    rootSpan?: { serviceName?: string; operationName?: string };
    duration_ms?: number;
    duration?: number;
    span_count?: number;
    spans?: unknown[];
    services?: string[];
    service_name?: string;
    serviceName?: string;
    start_time?: string;
    startTime?: string;
    status: string;
    trace_source?: string;
  };
  isSelected: boolean;
  onClick: () => void;
}

function TraceListItem({ trace, isSelected, onClick }: TraceListItemProps) {
  const traceId = trace.traceId || trace.trace_id || '';
  const serviceName = trace.serviceName || trace.service_name || trace.rootSpan?.serviceName || 'Unknown';
  const operationName = trace.root_span || trace.rootSpan?.operationName || 'Unknown operation';
  const duration = trace.duration ?? trace.duration_ms ?? 0;
  const spanCount = trace.span_count ?? trace.spans?.length ?? 0;
  const serviceCount = trace.services?.length ?? 1;
  const startTime = trace.startTime || trace.start_time || '';

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
          <span className="font-mono text-xs">{traceId.slice(0, 16)}</span>
        </div>
        <StatusBadge status={trace.status} showDot={false} />
      </div>
      <div className="mt-2">
        <p className="font-medium">{serviceName}</p>
        <p className="truncate text-sm text-muted-foreground">{operationName}</p>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Timer className="h-3 w-3" />
          {formatDuration(duration)}
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          {spanCount} spans
        </span>
        <span className="flex items-center gap-1">
          <Server className="h-3 w-3" />
          {serviceCount} services
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatDate(startTime)}</span>
        <span className="rounded border bg-muted/40 px-1.5 py-0.5">source: {trace.trace_source || 'unknown'}</span>
      </div>
    </button>
  );
}

export default function TraceExplorerPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'error'>('all');
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '6h' | '24h' | '7d' | 'all'>('24h');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [showServiceMap, setShowServiceMap] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [textFilterMode, setTextFilterMode] = useState<'exact' | 'contains'>('exact');
  const [httpMethodFilter, setHttpMethodFilter] = useState('');
  const [httpRouteFilter, setHttpRouteFilter] = useState('');
  const [httpStatusCodeFilter, setHttpStatusCodeFilter] = useState('');
  const [serviceNamespaceFilter, setServiceNamespaceFilter] = useState('');
  const [containerNameFilter, setContainerNameFilter] = useState('');
  const [k8sNamespaceFilter, setK8sNamespaceFilter] = useState('');
  const { interval, setInterval } = useAutoRefresh(0);

  const fromTime = useMemo(() => getFromIso(timeRange), [timeRange]);

  const traceQuery = useMemo(() => ({
    serviceName: serviceFilter || undefined,
    source: sourceFilter || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    from: fromTime,
    limit: 200,
    httpMethod: httpMethodFilter || undefined,
    httpRoute: httpRouteFilter || undefined,
    httpRouteMatch: textFilterMode,
    httpStatusCode: httpStatusCodeFilter ? Number(httpStatusCodeFilter) : undefined,
    serviceNamespace: serviceNamespaceFilter || undefined,
    serviceNamespaceMatch: textFilterMode,
    containerName: containerNameFilter || undefined,
    containerNameMatch: textFilterMode,
    k8sNamespace: k8sNamespaceFilter || undefined,
    k8sNamespaceMatch: textFilterMode,
  }), [
    serviceFilter,
    sourceFilter,
    statusFilter,
    fromTime,
    httpMethodFilter,
    httpRouteFilter,
    textFilterMode,
    httpStatusCodeFilter,
    serviceNamespaceFilter,
    containerNameFilter,
    k8sNamespaceFilter,
  ]);

  const { data: tracesData, isLoading, isError, error, refetch, isFetching } = useTraces(traceQuery);
  const { data: selectedTraceData } = useTrace(selectedTraceId || undefined);
  const { data: serviceMapData } = useServiceMap(traceQuery);
  const { data: summary } = useTraceSummary(traceQuery);

  const traces = useMemo(() => {
    if (!tracesData) return [];
    if (Array.isArray(tracesData)) return tracesData;
    if (Array.isArray((tracesData as { traces?: unknown[] }).traces)) {
      return (tracesData as { traces: unknown[] }).traces;
    }
    return [];
  }, [tracesData]) as Array<{
    trace_id?: string;
    traceId?: string;
    root_span?: string;
    rootSpan?: { serviceName?: string; operationName?: string };
    duration_ms?: number;
    duration?: number;
    status: string;
    service_name?: string;
    serviceName?: string;
    start_time?: string;
    startTime?: string;
    span_count?: number;
    spans?: unknown[];
    services?: string[];
    trace_source?: string;
  }>;

  const selectedTrace = useMemo(() => {
    if (!selectedTraceData) return null;
    const data = selectedTraceData as {
      traceId?: string;
      spans?: Array<{
        spanId?: string;
        span_id?: string;
        parentSpanId?: string;
        parent_span_id?: string;
        operationName?: string;
        name?: string;
        serviceName?: string;
        service_name?: string;
        startTime?: string;
        start_time?: string;
        duration?: number;
        duration_ms?: number;
        status: string;
        trace_source?: string;
        attributes?: unknown;
      }>;
    };
    if (!data.spans) return null;

    const normalizedSpans = data.spans.map((s) => ({
      spanId: s.spanId || s.span_id || '',
      parentSpanId: s.parentSpanId || s.parent_span_id,
      operationName: s.operationName || s.name || '',
      serviceName: s.serviceName || s.service_name || '',
      startTime: s.startTime || s.start_time || '',
      duration: s.duration ?? s.duration_ms ?? 0,
      status: s.status,
      traceSource: s.trace_source || 'unknown',
      attributes: parseAttributes(s.attributes),
    }));

    const hasError = normalizedSpans.some((s) => s.status === 'error');
    const uniqueServices = [...new Set(normalizedSpans.map((s) => s.serviceName))];

    return {
      traceId: data.traceId,
      spans: normalizedSpans,
      duration: Math.max(...normalizedSpans.map((s) => s.duration), 0),
      startTime: normalizedSpans[0]?.startTime || '',
      status: hasError ? 'error' : 'ok',
      services: uniqueServices,
      source: normalizedSpans[0]?.traceSource || 'unknown',
    };
  }, [selectedTraceData]);

  const filteredTraces = useMemo(() => {
    if (!traces || traces.length === 0) return [];
    return traces.filter((trace) => {
      if (statusFilter !== 'all' && trace.status !== statusFilter) return false;
      if (!searchQuery) return true;

      const q = searchQuery.toLowerCase();
      const traceId = (trace.traceId || trace.trace_id || '').toLowerCase();
      const serviceName = (trace.serviceName || trace.service_name || trace.rootSpan?.serviceName || '').toLowerCase();
      const operationName = (trace.root_span || trace.rootSpan?.operationName || '').toLowerCase();

      return traceId.includes(q) || serviceName.includes(q) || operationName.includes(q);
    });
  }, [traces, searchQuery, statusFilter]);

  const services = useMemo(() => {
    if (!traces || traces.length === 0) return [];
    const set = new Set<string>();
    traces.forEach((t) => {
      const serviceName = t.serviceName || t.service_name;
      if (serviceName) set.add(serviceName);
      t.services?.forEach((s) => set.add(s));
    });
    return Array.from(set).sort();
  }, [traces]);

  const spanTree = useMemo(() => {
    if (!selectedTrace?.spans || selectedTrace.spans.length === 0) return [];

    const spans = selectedTrace.spans;
    const rootSpans = spans.filter((s) => !s.parentSpanId);

    type SpanType = typeof spans[0];
    const buildTree = (span: SpanType, depth: number): Array<{ span: SpanType; depth: number }> => {
      const result = [{ span, depth }];
      const children = spans.filter((s) => s.parentSpanId === span.spanId);
      children.forEach((child) => {
        result.push(...buildTree(child, depth + 1));
      });
      return result;
    };

    return rootSpans.flatMap((root) => buildTree(root, 0));
  }, [selectedTrace]);

  const selectedSpan = useMemo(() => {
    if (!selectedTrace?.spans || selectedTrace.spans.length === 0) return null;
    if (!selectedSpanId) return selectedTrace.spans[0];
    return selectedTrace.spans.find((s) => s.spanId === selectedSpanId) || selectedTrace.spans[0];
  }, [selectedTrace, selectedSpanId]);

  const serviceMapNodes = useMemo(() => {
    if (!serviceMapData?.nodes) return [];
    return serviceMapData.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      callCount: n.callCount || 0,
      avgDuration: n.avgDuration || 0,
      errorRate: n.errorRate || 0,
    }));
  }, [serviceMapData]);

  const serviceMapEdges = useMemo(() => {
    if (!serviceMapData?.edges) return [];
    return serviceMapData.edges.map((e) => ({
      source: e.source,
      target: e.target,
      callCount: e.callCount || 0,
      avgDuration: e.avgDuration || 0,
    }));
  }, [serviceMapData]);

  const sourceCounts = summary?.sourceCounts ?? { http: 0, ebpf: 0, scheduler: 0, unknown: 0 };
  const hasAdvancedFiltersApplied = Boolean(
    httpMethodFilter || httpRouteFilter || httpStatusCodeFilter || serviceNamespaceFilter || containerNameFilter || k8sNamespaceFilter || textFilterMode !== 'exact'
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trace Explorer</h1>
          <p className="text-muted-foreground">Distributed trace visualization with service map</p>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trace Explorer</h1>
          <p className="text-muted-foreground">Distributed trace visualization with service map</p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {summary && (
        <>
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
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
            <span className="font-medium text-muted-foreground">Source counters:</span>
            <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-1">eBPF: {sourceCounts.ebpf}</span>
            <span className="rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1">HTTP: {sourceCounts.http}</span>
            <span className="rounded border border-violet-500/40 bg-violet-500/15 px-2 py-1">Scheduler: {sourceCounts.scheduler}</span>
            <span className="rounded border bg-muted/40 px-2 py-1">Unknown: {sourceCounts.unknown}</span>
          </div>
        </>
      )}

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search traces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={serviceFilter || '__all__'}
              onValueChange={(val) => setServiceFilter(val === '__all__' ? '' : val)}
              options={[
                { value: '__all__', label: 'All services' },
                ...services.map((s) => ({ value: s, label: s })),
              ]}
              className="text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={sourceFilter || '__all__'}
              onValueChange={(val) => setSourceFilter(val === '__all__' ? '' : val)}
              options={[
                { value: '__all__', label: 'All sources' },
                { value: 'http', label: 'HTTP Requests' },
                { value: 'scheduler', label: 'Background Jobs' },
                { value: 'ebpf', label: 'eBPF (Apps)' },
              ]}
              className="text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={timeRange}
              onValueChange={(val) => setTimeRange(val as typeof timeRange)}
              options={[
                { value: '15m', label: 'Last 15m' },
                { value: '1h', label: 'Last 1h' },
                { value: '6h', label: 'Last 6h' },
                { value: '24h', label: 'Last 24h' },
                { value: '7d', label: 'Last 7d' },
                { value: 'all', label: 'All time' },
              ]}
              className="text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex overflow-hidden rounded-md border border-input">
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

        <div className="flex items-center justify-between border-t pt-3">
          <button
            type="button"
            onClick={() => setShowAdvancedFilters((prev) => !prev)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showAdvancedFilters ? 'Hide advanced filters' : 'Show advanced filters'}
          </button>
          {hasAdvancedFiltersApplied && (
            <button
              type="button"
              onClick={() => {
                setHttpMethodFilter('');
                setHttpRouteFilter('');
                setHttpStatusCodeFilter('');
                setServiceNamespaceFilter('');
                setContainerNameFilter('');
                setK8sNamespaceFilter('');
                setTextFilterMode('exact');
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear advanced filters
            </button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="grid gap-3 rounded-md border bg-background/60 p-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Text Match Mode</p>
              <ThemedSelect
                value={textFilterMode}
                onValueChange={(val) => setTextFilterMode(val as 'exact' | 'contains')}
                options={[
                  { value: 'exact', label: 'Exact match' },
                  { value: 'contains', label: 'Contains' },
                ]}
                className="text-sm"
              />
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">HTTP Method</p>
              <ThemedSelect
                value={httpMethodFilter || '__all__'}
                onValueChange={(val) => setHttpMethodFilter(val === '__all__' ? '' : val)}
                options={[
                  { value: '__all__', label: 'Any method' },
                  { value: 'GET', label: 'GET' },
                  { value: 'POST', label: 'POST' },
                  { value: 'PUT', label: 'PUT' },
                  { value: 'PATCH', label: 'PATCH' },
                  { value: 'DELETE', label: 'DELETE' },
                ]}
                className="text-sm"
              />
            </div>

            <label className="text-xs text-muted-foreground">
              HTTP Route
              <input
                type="text"
                value={httpRouteFilter}
                onChange={(e) => setHttpRouteFilter(e.target.value)}
                placeholder="/api/users/:id"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              HTTP Status Code
              <input
                type="number"
                value={httpStatusCodeFilter}
                onChange={(e) => setHttpStatusCodeFilter(e.target.value)}
                placeholder="500"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Service Namespace
              <input
                type="text"
                value={serviceNamespaceFilter}
                onChange={(e) => setServiceNamespaceFilter(e.target.value)}
                placeholder="prod-eu-1"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Container Name
              <input
                type="text"
                value={containerNameFilter}
                onChange={(e) => setContainerNameFilter(e.target.value)}
                placeholder="api-container"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              K8s Namespace
              <input
                type="text"
                value={k8sNamespaceFilter}
                onChange={(e) => setK8sNamespaceFilter(e.target.value)}
                placeholder="payments"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
        )}
      </div>

      {showServiceMap && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-4 text-lg font-semibold">Service Dependency Map</h3>
          <ServiceMap serviceNodes={serviceMapNodes} serviceEdges={serviceMapEdges} />
        </div>
      )}

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
            {searchQuery || serviceFilter || sourceFilter || hasAdvancedFiltersApplied
              ? 'Try adjusting your search or filter criteria.'
              : 'No distributed traces have been collected yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="max-h-[600px] space-y-3 overflow-y-auto pr-2">
            {filteredTraces.map((trace) => {
              const id = trace.traceId || trace.trace_id || '';
              return (
                <TraceListItem
                  key={id}
                  trace={trace}
                  isSelected={selectedTraceId === id}
                  onClick={() => {
                    setSelectedTraceId(id);
                    setSelectedSpanId(null);
                  }}
                />
              );
            })}
          </div>

          <div className="lg:col-span-2">
            {selectedTraceId && selectedTrace ? (
              <div className="rounded-lg border bg-card">
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
                    <span className="rounded border bg-muted/40 px-1.5 py-0.5">source: {selectedTrace.source}</span>
                  </div>
                </div>

                <div className="p-4">
                  <h4 className="mb-3 text-sm font-medium text-muted-foreground">Span Timeline</h4>
                  <div className="max-h-[300px] space-y-1 overflow-y-auto">
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

                {selectedSpan && (
                  <div className="border-t p-4">
                    <h4 className="mb-3 text-sm font-medium text-muted-foreground">Span Details</h4>
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
                          <p className="mb-2 text-xs text-muted-foreground">Attributes</p>
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
                  <p className="mt-2 text-sm text-muted-foreground">Select a trace to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
