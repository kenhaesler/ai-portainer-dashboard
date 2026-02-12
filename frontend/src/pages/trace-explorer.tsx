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
  Info,
  Box,
  Rows,
  ArrowUpDown,
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

type TraceSource = 'ebpf' | 'http' | 'scheduler' | 'unknown';

function normalizeSource(source: string | undefined): TraceSource {
  if (!source) return 'unknown';
  const normalized = source.toLowerCase();
  if (normalized === 'ebpf') return 'ebpf';
  if (normalized === 'http') return 'http';
  if (normalized === 'scheduler') return 'scheduler';
  return 'unknown';
}

function getSourceBadgeClass(source: string | undefined): string {
  const normalized = normalizeSource(source);
  if (normalized === 'ebpf') return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
  if (normalized === 'http') return 'border-sky-500/40 bg-sky-500/15 text-sky-200';
  if (normalized === 'scheduler') return 'border-violet-500/40 bg-violet-500/15 text-violet-200';
  return 'border-muted bg-muted/40 text-muted-foreground';
}

function getSourceDescription(source: string | undefined): string {
  const normalized = normalizeSource(source);
  if (normalized === 'ebpf') return 'eBPF/Beyla runtime traces from instrumented workloads';
  if (normalized === 'http') return 'Dashboard API gateway request tracing';
  if (normalized === 'scheduler') return 'Background scheduler execution traces';
  return 'Unknown trace source';
}

function SourceBadge({ source }: { source: string | undefined }) {
  const normalized = normalizeSource(source);
  return (
    <span
      className={cn('rounded border px-1.5 py-0.5', getSourceBadgeClass(source))}
      title={getSourceDescription(source)}
    >
      source: {normalized}
    </span>
  );
}

type SpanItem = {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  serviceNamespace: string;
  serviceInstance: string;
  startTime: string;
  endTime: string | null;
  duration: number;
  kind: string;
  status: string;
  source: string;
  endpoint: string;
  container: string;
  rawAttributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
};

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
  if (typeof attributes === 'object') {
    return attributes as Record<string, unknown>;
  }
  return {};
}

function getAttrString(attrs: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return undefined;
}

function splitResourceAttributes(attrs: Record<string, unknown>) {
  const resourcePrefixes = ['service.', 'container.', 'k8s.', 'host.', 'deployment.', 'telemetry.'];
  const resourceAttributes: Record<string, unknown> = {};

  Object.entries(attrs).forEach(([key, value]) => {
    if (resourcePrefixes.some((prefix) => key.startsWith(prefix))) {
      resourceAttributes[key] = value;
    }
  });

  return resourceAttributes;
}

function getKeyAttributesForDrawer(span: SpanItem): Array<{ label: string; value: string }> {
  const attrs = span.rawAttributes;
  const candidates: Array<{ label: string; keys: string[] }> = [
    { label: 'HTTP Method', keys: ['http.method'] },
    { label: 'HTTP Route', keys: ['http.route', 'url.path', 'http.target'] },
    { label: 'HTTP Status', keys: ['http.status_code', 'statusCode'] },
    { label: 'Server Address', keys: ['server.address', 'host.name'] },
    { label: 'Server Port', keys: ['server.port'] },
    { label: 'Client Address', keys: ['client.address', 'net.sock.peer.addr'] },
    { label: 'Service Namespace', keys: ['service.namespace'] },
    { label: 'Service Instance', keys: ['service.instance.id'] },
    { label: 'Service Version', keys: ['service.version'] },
    { label: 'Environment', keys: ['deployment.environment'] },
    { label: 'Container ID', keys: ['container.id'] },
    { label: 'Container Name', keys: ['container.name', 'k8s.container.name'] },
    { label: 'K8s Namespace', keys: ['k8s.namespace.name'] },
    { label: 'K8s Pod', keys: ['k8s.pod.name'] },
  ];

  const keyAttributes = candidates
    .map((candidate) => {
      const value = getAttrString(attrs, candidate.keys);
      return value ? { label: candidate.label, value } : null;
    })
    .filter((item): item is { label: string; value: string } => item !== null);

  return keyAttributes;
}

interface SpanBarProps {
  span: SpanItem;
  traceStartTime: number;
  traceDuration: number;
  depth: number;
  isSelected: boolean;
  onClick: () => void;
}

function SpanBar({ span, traceStartTime, traceDuration, depth, isSelected, onClick }: SpanBarProps) {
  const spanStart = new Date(span.startTime).getTime();
  const offsetPercent = ((spanStart - traceStartTime) / Math.max(traceDuration, 1)) * 100;
  const widthPercent = Math.max((span.duration / Math.max(traceDuration, 1)) * 100, 1);

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
      <div className="w-44 shrink-0 truncate text-xs text-muted-foreground">{span.operationName}</div>
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
      <div className="w-20 shrink-0 text-right text-xs text-muted-foreground">{formatDuration(span.duration)}</div>
      {span.status === 'error' && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
    </button>
  );
}

type TraceItem = {
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

interface TraceListItemProps {
  trace: TraceItem;
  isSelected: boolean;
  onClick: () => void;
  sourceLabel: string;
  endpointLabel: string;
  containerLabel: string;
}

function TraceListItem({ trace, isSelected, onClick, sourceLabel, endpointLabel, containerLabel }: TraceListItemProps) {
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <SourceBadge source={sourceLabel} />
        <span className="rounded border bg-muted/40 px-1.5 py-0.5">endpoint: {endpointLabel}</span>
        <span className="rounded border bg-muted/40 px-1.5 py-0.5">container: {containerLabel}</span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{formatDate(startTime)}</div>
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
  const [spanFilter, setSpanFilter] = useState('');
  const [sortBy, setSortBy] = useState<'startTime' | 'serviceName' | 'operationName' | 'kind' | 'status' | 'duration'>('startTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { interval, setInterval } = useAutoRefresh(0);

  const fromTime = useMemo(() => getFromIso(timeRange), [timeRange]);

  const traceQuery = useMemo(() => ({
    serviceName: serviceFilter || undefined,
    source: sourceFilter || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    from: fromTime,
    limit: 200,
  }), [serviceFilter, sourceFilter, statusFilter, fromTime]);

  const { data: tracesData, isLoading, isError, error, refetch, isFetching } = useTraces(traceQuery);
  const { data: selectedTraceData } = useTrace(selectedTraceId || undefined);
  const { data: serviceMapData, isLoading: isServiceMapLoading } = useServiceMap(traceQuery);
  const { data: summary } = useTraceSummary({ from: fromTime });

  const traces = useMemo(() => {
    if (!tracesData) return [];
    if (Array.isArray(tracesData)) return tracesData;
    if (Array.isArray((tracesData as { traces?: unknown[] }).traces)) {
      return (tracesData as { traces: unknown[] }).traces;
    }
    return [];
  }, [tracesData]) as TraceItem[];

  const selectedTrace = useMemo(() => {
    if (!selectedTraceData) return null;

    const data = selectedTraceData as {
      traceId?: string;
      spans?: Array<{
        spanId?: string;
        span_id?: string;
        traceId?: string;
        trace_id?: string;
        parentSpanId?: string;
        parent_span_id?: string;
        operationName?: string;
        name?: string;
        serviceName?: string;
        service_name?: string;
        startTime?: string;
        start_time?: string;
        endTime?: string;
        end_time?: string | null;
        duration?: number;
        duration_ms?: number;
        kind?: string;
        status: string;
        trace_source?: string;
        attributes?: unknown;
      }>;
    };

    if (!data.spans) return null;

    const normalizedSpans: SpanItem[] = data.spans.map((s) => {
      const attrs = parseAttributes(s.attributes);
      const resourceAttributes = splitResourceAttributes(attrs);

      const source = s.trace_source || getAttrString(attrs, ['trace.source', 'telemetry.source']) || 'unknown';
      const endpoint = getAttrString(attrs, ['endpoint.name', 'endpoint.id', 'endpoint', 'host.name']) || 'unknown';
      const container = getAttrString(attrs, ['container.name', 'container.id', 'k8s.container.name', 'docker.container.name']) || 'unknown';

      return {
        spanId: s.spanId || s.span_id || '',
        traceId: s.traceId || s.trace_id || data.traceId || '',
        parentSpanId: s.parentSpanId || s.parent_span_id,
        operationName: s.operationName || s.name || '',
        serviceName: s.serviceName || s.service_name || 'unknown',
        serviceNamespace: getAttrString(attrs, ['service.namespace']) || 'unknown',
        serviceInstance: getAttrString(attrs, ['service.instance.id']) || 'unknown',
        startTime: s.startTime || s.start_time || '',
        endTime: s.endTime || s.end_time || null,
        duration: s.duration ?? s.duration_ms ?? 0,
        kind: s.kind || 'internal',
        status: s.status,
        source,
        endpoint,
        container,
        rawAttributes: attrs,
        resourceAttributes,
      };
    });

    const hasError = normalizedSpans.some((s) => s.status === 'error');
    const uniqueServices = [...new Set(normalizedSpans.map((s) => s.serviceName))];

    const rootSpan = normalizedSpans.find((s) => !s.parentSpanId) || normalizedSpans[0];

    return {
      traceId: data.traceId || normalizedSpans[0]?.traceId || '',
      spans: normalizedSpans,
      duration: Math.max(...normalizedSpans.map((s) => s.duration), 0),
      startTime: rootSpan?.startTime || normalizedSpans[0]?.startTime || '',
      status: hasError ? 'error' : 'ok',
      services: uniqueServices,
      source: rootSpan?.source || 'unknown',
      endpoint: rootSpan?.endpoint || 'unknown',
      container: rootSpan?.container || 'unknown',
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

    const buildTree = (span: SpanItem, depth: number): Array<{ span: SpanItem; depth: number }> => {
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

  const hasOnlyServerSpans = useMemo(() => {
    if (!selectedTrace?.spans || selectedTrace.spans.length === 0) return false;
    return selectedTrace.spans.every((s) => s.kind === 'server');
  }, [selectedTrace]);

  const spanRows = useMemo(() => {
    if (!selectedTrace?.spans) return [];

    const q = spanFilter.trim().toLowerCase();
    const rows = selectedTrace.spans.filter((s) => {
      if (!q) return true;
      return (
        s.operationName.toLowerCase().includes(q)
        || s.serviceName.toLowerCase().includes(q)
        || s.status.toLowerCase().includes(q)
        || s.kind.toLowerCase().includes(q)
        || s.traceId.toLowerCase().includes(q)
        || s.spanId.toLowerCase().includes(q)
      );
    });

    return rows.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;

      if (sortBy === 'duration') return (a.duration - b.duration) * dir;
      if (sortBy === 'startTime') return (new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) * dir;

      const left = String(a[sortBy] ?? '').toLowerCase();
      const right = String(b[sortBy] ?? '').toLowerCase();
      return left.localeCompare(right) * dir;
    });
  }, [selectedTrace, spanFilter, sortBy, sortDir]);

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

  const sourceHint = useMemo(() => {
    if (sourceFilter === 'ebpf') {
      return 'Showing runtime traces from Beyla/eBPF instrumentation.';
    }
    if (sourceFilter === 'http') {
      return 'Showing API gateway request traces generated by dashboard request tracing.';
    }
    if (sourceFilter === 'scheduler') {
      return 'Showing background scheduler traces.';
    }
    return 'Showing all trace sources. Use source filter to inspect HTTP vs eBPF behavior.';
  }, [sourceFilter]);

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

      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
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
        <p className="text-xs text-muted-foreground" title="Trace source legend and context">
          {sourceHint}
        </p>
        {!sourceFilter && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <SourceBadge source="ebpf" />
            <SourceBadge source="http" />
            <SourceBadge source="scheduler" />
          </div>
        )}

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

      {showServiceMap && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Service Dependency Map</h3>
            <p className="text-xs text-muted-foreground">Computed from current filters and selected time range</p>
          </div>
          {isServiceMapLoading ? (
            <div className="flex h-[300px] items-center justify-center text-muted-foreground">Computing service map...</div>
          ) : serviceMapNodes.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-muted-foreground">
              No service-map data for the current filters
            </div>
          ) : (
            <ServiceMap serviceNodes={serviceMapNodes} serviceEdges={serviceMapEdges} />
          )}
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
            {searchQuery || serviceFilter || sourceFilter
              ? sourceFilter === 'ebpf'
                ? 'No eBPF traces matched. Verify Beyla is running and OTLP ingestion is configured.'
                : sourceFilter === 'http'
                  ? 'No HTTP request traces matched. Try broadening filters or time range.'
                  : sourceFilter === 'scheduler'
                    ? 'No scheduler traces matched for this range.'
                    : 'Try adjusting your search or filter criteria.'
              : 'No distributed traces have been collected yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="max-h-[700px] space-y-3 overflow-y-auto pr-2">
            {filteredTraces.map((trace) => {
              const id = trace.traceId || trace.trace_id || '';

              const sourceLabel = trace.trace_source || 'unknown';
              const endpointLabel = selectedTraceId === id && selectedTrace ? selectedTrace.endpoint : 'unknown';
              const containerLabel = selectedTraceId === id && selectedTrace ? selectedTrace.container : 'unknown';

              return (
                <TraceListItem
                  key={id}
                  trace={trace}
                  isSelected={selectedTraceId === id}
                  sourceLabel={sourceLabel}
                  endpointLabel={endpointLabel}
                  containerLabel={containerLabel}
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
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    <span>{formatDuration(selectedTrace.duration)}</span>
                    <span>{selectedTrace.spans?.length || 0} spans</span>
                    <span>{selectedTrace.services?.length || 0} services</span>
                    <span>{formatDate(selectedTrace.startTime)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <SourceBadge source={selectedTrace.source} />
                    <span className="rounded border bg-muted/40 px-1.5 py-0.5">endpoint: {selectedTrace.endpoint}</span>
                    <span className="rounded border bg-muted/40 px-1.5 py-0.5">container: {selectedTrace.container}</span>
                  </div>
                </div>

                <div className="grid gap-0 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                  <div className="p-4">
                    <h4 className="mb-3 text-sm font-medium text-muted-foreground">Span Timeline</h4>
                    <div className="max-h-[320px] space-y-1 overflow-y-auto">
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

                    {hasOnlyServerSpans && (
                      <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <Info className="mt-0.5 h-4 w-4 text-amber-500" />
                          <div>
                            <p className="font-medium">Missing client span detected</p>
                            <p className="text-muted-foreground">
                              eBPF/Beyla often instruments only the server process for this trace. Short-lived clients like curl loops may not appear as stable client services.
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              Hint: instrument a long-running client process (or another service) and verify OTLP export on both source and destination.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-6">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <h4 className="text-sm font-medium text-muted-foreground">Raw Spans</h4>
                        <div className="relative w-full max-w-sm">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            type="text"
                            placeholder="Filter spans..."
                            value={spanFilter}
                            onChange={(e) => setSpanFilter(e.target.value)}
                            className="w-full rounded-md border border-input bg-background py-1.5 pl-9 pr-3 text-xs"
                          />
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-muted/40 text-muted-foreground">
                            <tr>
                              {[
                                { id: 'startTime', label: 'Timestamp' },
                                { id: 'serviceName', label: 'Service' },
                                { id: 'operationName', label: 'Span Name' },
                                { id: 'kind', label: 'Kind' },
                                { id: 'status', label: 'Status' },
                                { id: 'duration', label: 'Duration' },
                              ].map((col) => (
                                <th key={col.id} className="px-3 py-2">
                                  <button
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    onClick={() => {
                                      if (sortBy === col.id) {
                                        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                                      } else {
                                        setSortBy(col.id as typeof sortBy);
                                        setSortDir('desc');
                                      }
                                    }}
                                  >
                                    {col.label}
                                    <ArrowUpDown className="h-3 w-3" />
                                  </button>
                                </th>
                              ))}
                              <th className="px-3 py-2">Trace / Span</th>
                            </tr>
                          </thead>
                          <tbody>
                            {spanRows.map((span) => (
                              <tr
                                key={span.spanId}
                                onClick={() => setSelectedSpanId(span.spanId)}
                                className={cn(
                                  'cursor-pointer border-t hover:bg-muted/30',
                                  selectedSpanId === span.spanId && 'bg-primary/10'
                                )}
                              >
                                <td className="px-3 py-2 whitespace-nowrap">{formatDate(span.startTime)}</td>
                                <td className="px-3 py-2">{span.serviceName}</td>
                                <td className="px-3 py-2">{span.operationName}</td>
                                <td className="px-3 py-2">{span.kind}</td>
                                <td className="px-3 py-2">{span.status}</td>
                                <td className="px-3 py-2">{formatDuration(span.duration)}</td>
                                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                                  <div>{span.traceId.slice(0, 14)}</div>
                                  <div>{span.spanId.slice(0, 14)}</div>
                                </td>
                              </tr>
                            ))}
                            {spanRows.length === 0 && (
                              <tr>
                                <td className="px-3 py-5 text-center text-muted-foreground" colSpan={7}>
                                  No spans match this filter
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="border-t p-4 xl:border-l xl:border-t-0">
                    <h4 className="mb-3 text-sm font-medium text-muted-foreground">Trace Details Drawer</h4>
                    {selectedSpan ? (
                      <div className="space-y-4">
                        {getKeyAttributesForDrawer(selectedSpan).length > 0 && (
                          <div>
                            <p className="mb-2 text-xs font-medium text-muted-foreground">Key Attributes</p>
                            <div className="grid gap-2">
                              {getKeyAttributesForDrawer(selectedSpan).map((item) => (
                                <div key={item.label} className="rounded border bg-muted/20 px-2 py-1.5">
                                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                                  <p className="text-xs break-all">{item.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Trace ID</p>
                            <p className="font-mono text-xs break-all">{selectedSpan.traceId}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Span ID</p>
                            <p className="font-mono text-xs break-all">{selectedSpan.spanId}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Parent Span ID</p>
                            <p className="font-mono text-xs break-all">{selectedSpan.parentSpanId || 'none'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Service</p>
                            <p className="font-medium">{selectedSpan.serviceName}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Namespace</p>
                              <p className="text-sm">{selectedSpan.serviceNamespace}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Instance</p>
                              <p className="text-sm">{selectedSpan.serviceInstance}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Span</p>
                            <p className="font-medium">{selectedSpan.operationName}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Kind</p>
                              <p className="text-sm">{selectedSpan.kind}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Status</p>
                              <StatusBadge status={selectedSpan.status} />
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Start / End</p>
                            <p className="text-sm">{formatDate(selectedSpan.startTime)} / {selectedSpan.endTime ? formatDate(selectedSpan.endTime) : 'unknown'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Duration</p>
                            <p className="text-sm">{formatDuration(selectedSpan.duration)}</p>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <div className="inline-flex max-w-max items-center gap-1 text-[11px]">
                              <Rows className="h-3 w-3" />
                              <SourceBadge source={selectedSpan.source} />
                            </div>
                            <div className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px]">
                              <Server className="h-3 w-3" /> endpoint: {selectedSpan.endpoint}
                            </div>
                            <div className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px]">
                              <Box className="h-3 w-3" /> container: {selectedSpan.container}
                            </div>
                          </div>
                        </div>

                        <details className="rounded-md border p-2" open>
                          <summary className="cursor-pointer text-xs font-medium">Raw span attributes JSON</summary>
                          <pre className="mt-2 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                            {JSON.stringify(selectedSpan.rawAttributes, null, 2)}
                          </pre>
                        </details>

                        <details className="rounded-md border p-2" open>
                          <summary className="cursor-pointer text-xs font-medium">Resource attributes JSON</summary>
                          <pre className="mt-2 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                            {JSON.stringify(selectedSpan.resourceAttributes, null, 2)}
                          </pre>
                        </details>

                        <details className="rounded-md border p-2">
                          <summary className="cursor-pointer text-xs font-medium">Span events JSON</summary>
                          <pre className="mt-2 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                            {JSON.stringify((selectedSpan.rawAttributes.events ?? []), null, 2)}
                          </pre>
                        </details>
                      </div>
                    ) : (
                      <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed bg-muted/20 text-center">
                        <div>
                          <ChevronRight className="mx-auto h-8 w-8 text-muted-foreground" />
                          <p className="mt-2 text-sm text-muted-foreground">Select a span from timeline or table</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[700px] items-center justify-center rounded-lg border border-dashed bg-muted/20">
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
