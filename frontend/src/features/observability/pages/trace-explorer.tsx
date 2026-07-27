import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  ScrollText,
  HelpCircle,
} from 'lucide-react';
import { useTraces, useTrace, useServiceMap, useTraceSummary } from '@/features/observability/hooks/use-traces';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { ServiceMap } from '@/shared/components/charts/service-map';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { DataFreshness } from '@/shared/components/feedback/data-freshness';
import { SkeletonChart, SkeletonList } from '@/shared/components/feedback/skeleton';
import { cn, formatDate } from '@/shared/lib/utils';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { PageHeader } from '@/shared/components/layout/page-header';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * The z-score at which a trace is called out as anomalous.
 *
 * The backend trace detector flags a service whose latency `p95` deviates by
 * `TRACES_ANOMALY_P95_ZSCORE` (default 3.0) standard deviations from its
 * baseline. This page used to show `Avg Duration` and never mentioned p95 or a
 * z-score at all, so an operator could not tell which traces the detector was
 * reasoning about. The same threshold is applied here — to trace duration
 * within the loaded window — so the two agree on what "unusual" means.
 */
export const ANOMALY_Z_THRESHOLD = 3;

export interface DurationStats {
  count: number;
  p50: number;
  p95: number;
  mean: number;
  stdDev: number;
}

/** Nearest-rank percentile over an ascending-sorted array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index];
}

/** p50/p95 plus the mean and population stddev the z-score filter uses. */
export function computeDurationStats(durations: number[]): DurationStats {
  const count = durations.length;
  if (count === 0) return { count: 0, p50: 0, p95: 0, mean: 0, stdDev: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const mean = durations.reduce((sum, d) => sum + d, 0) / count;
  const variance = durations.reduce((sum, d) => sum + (d - mean) ** 2, 0) / count;
  return {
    count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    mean,
    stdDev: Math.sqrt(variance),
  };
}

/** Deviation of one duration from the loaded window, or null when flat. */
export function durationZScore(duration: number, stats: DurationStats): number | null {
  if (stats.count < 2 || stats.stdDev <= 0) return null;
  return (duration - stats.mean) / stats.stdDev;
}

/**
 * CORS preflights. On the captured fleet 83 of 193 traces were `OPTIONS *` —
 * they carry no diagnostic signal and crowd out the traces that do.
 */
export function isPreflightOperation(operationName: string): boolean {
  return /^options\b/i.test(operationName.trim());
}

/** Fallback row height for the virtualizer before a card is measured. */
const TRACE_ROW_ESTIMATED_HEIGHT = 128;

/** The one value shared by every row, or null when it varies (or N < 2). */
export function constantValue(values: string[]): string | null {
  if (values.length < 2) return null;
  const first = values[0];
  return values.every((v) => v === first) ? first : null;
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

type TraceSource = 'ebpf' | 'http' | 'scheduler' | 'unknown';

/**
 * One label per source value.
 *
 * The page previously spoke three dialects at once for the same three-valued
 * enum: counter chips said "eBPF / HTTP / Scheduler", the dropdown said
 * "eBPF (Apps) / HTTP Requests / Background Jobs", and the badges said
 * "source: ebpf / source: http / source: scheduler" — all visible together.
 */
const SOURCE_LABELS: Record<TraceSource, string> = {
  ebpf: 'eBPF',
  http: 'HTTP',
  scheduler: 'Scheduler',
  unknown: 'Unknown',
};

const FILTERABLE_SOURCES: TraceSource[] = ['ebpf', 'http', 'scheduler'];

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
  if (normalized === 'ebpf') return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  if (normalized === 'http') return 'border-sky-500/40 bg-sky-500/15 text-sky-300';
  if (normalized === 'scheduler') return 'border-violet-500/40 bg-violet-500/15 text-violet-300';
  return 'border-muted bg-muted/40 text-muted-foreground';
}

function getSourceDescription(source: string | undefined): string {
  const normalized = normalizeSource(source);
  if (normalized === 'ebpf') return 'Runtime traces from eBPF/Beyla instrumentation';
  if (normalized === 'http') return 'Dashboard API request tracing';
  if (normalized === 'scheduler') return 'Background scheduler traces';
  return 'Unknown trace source';
}

function SourceBadge({ source }: { source: string | undefined }) {
  const normalized = normalizeSource(source);
  return (
    <span
      className={cn('rounded border px-1.5 py-0.5', getSourceBadgeClass(source))}
      title={getSourceDescription(source)}
    >
      source: {SOURCE_LABELS[normalized]}
    </span>
  );
}

/**
 * The source filter. These chips used to be decorative `<span>`s sitting under
 * copy that told the operator to click them, while the actual control was a
 * separate dropdown with different wording. Now they are the control.
 */
function SourceFilterChip({
  source,
  count,
  active,
  onSelect,
}: {
  source: TraceSource | 'all';
  count?: number;
  active: boolean;
  onSelect: () => void;
}) {
  const label = source === 'all' ? 'All sources' : SOURCE_LABELS[source];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={source === 'all' ? 'Every ingestion path' : getSourceDescription(source)}
      className={cn(
        'rounded border px-2 py-1 text-xs font-medium transition-colors',
        source === 'all' || !active ? 'border-input bg-background hover:bg-muted' : getSourceBadgeClass(source),
        active && 'ring-1 ring-primary',
        active && source === 'all' && 'bg-primary text-primary-foreground hover:bg-primary/90'
      )}
    >
      {label}
      {count !== undefined && <span className="ml-1 tabular-nums opacity-80">{count}</span>}
    </button>
  );
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

function getAttrNumber(attrs: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getFirstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const asString = String(value).trim();
    if (asString.length > 0) return asString;
  }
  return undefined;
}

function getSpanSource(traceSource: string | undefined, attrs: Record<string, unknown>): string {
  return getFirstString(traceSource, getAttrString(attrs, ['trace.source', 'telemetry.source'])) || 'unknown';
}

function getSpanEndpoint(trace: Record<string, unknown>, attrs: Record<string, unknown>): string {
  return getFirstString(
    trace.http_route,
    trace.url_full,
    trace.server_address,
    trace.net_peer_name,
    getAttrString(attrs, [
      'endpoint.name',
      'endpoint.id',
      'endpoint',
      'http.route',
      'url',
      'url.path',
      'http.target',
      'url.full',
      'http.url',
      'service.instance.id',
      'server.address',
      'net.peer.name',
      'net.host.name',
      'host.name',
    ]),
  ) || 'unknown';
}

function getSpanContainer(trace: Record<string, unknown>, attrs: Record<string, unknown>): string {
  return getFirstString(
    trace.container_name,
    trace.k8s_container_name,
    trace.container_id,
    getAttrString(attrs, [
      'container.name',
      'k8s.container.name',
      'k8s.pod.name',
      'service.instance.id',
      'host.name',
      'container.id',
      'docker.container.name',
    ]),
  ) || 'unknown';
}

function getTraceEndpointLabel(trace: Record<string, unknown>): string {
  return (
    (typeof trace.http_route === 'string' && trace.http_route)
    || (typeof trace.url_full === 'string' && trace.url_full)
    || (typeof trace.server_address === 'string' && trace.server_address)
    || (typeof trace.net_peer_name === 'string' && trace.net_peer_name)
    || 'unknown'
  );
}

function getTraceContainerLabel(trace: Record<string, unknown>): string {
  return (
    (typeof trace.container_name === 'string' && trace.container_name)
    || (typeof trace.k8s_container_name === 'string' && trace.k8s_container_name)
    || (typeof trace.container_id === 'string' && trace.container_id)
    || 'unknown'
  );
}

function getSpanKindDescription(kind: string): string {
  if (kind === 'server') return 'Server span: work handled by a receiving service.';
  if (kind === 'client') return 'Client span: outbound request to another service.';
  if (kind === 'internal') return 'Internal span: in-process work inside one service.';
  return 'Span kind from OTEL instrumentation.';
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

/** One row of the trace list, already flattened out of the API's two casings. */
interface TraceRow {
  id: string;
  status: string;
  duration: number;
  operation: string;
  service: string;
  source: string;
  endpoint: string;
  container: string;
  spanCount: number;
  serviceCount: number;
  startTime: string;
  isPreflight: boolean;
  zScore: number | null;
}

/** Which of the repeated fields are identical on every loaded row. */
interface ConstantFields {
  service: string | null;
  source: string | null;
  endpoint: string | null;
  container: string | null;
  serviceCount: string | null;
}

interface TraceListItemProps {
  row: TraceRow;
  isSelected: boolean;
  onClick: () => void;
  /** Fields whose value is the same on every row — rendered once above the list. */
  constants: ConstantFields;
}

function TraceListItem({ row, isSelected, onClick, constants }: TraceListItemProps) {
  const isAnomalous = row.zScore !== null && row.zScore >= ANOMALY_Z_THRESHOLD;

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
      {/* Duration and status lead: they are the two fields that actually vary. */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
          <Timer className="h-4 w-4 text-muted-foreground" />
          {formatDuration(row.duration)}
        </span>
        <span className="flex items-center gap-2">
          {isAnomalous && (
            <span
              className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
              title={`Duration is ${row.zScore?.toFixed(1)} standard deviations above the mean of the loaded window.`}
            >
              z={row.zScore?.toFixed(1)}
            </span>
          )}
          <StatusBadge status={row.status} showDot={false} />
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium">{row.operation}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-mono">
          <GitBranch className="h-3 w-3" />
          {row.id.slice(0, 12)}
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          {row.spanCount} spans
        </span>
        {constants.service === null && (
          <span className="flex items-center gap-1">
            <Server className="h-3 w-3" />
            {row.service}
          </span>
        )}
        {/* "1 services" was on all 193 rows; it earns its place only when it varies. */}
        {constants.serviceCount === null && <span>{row.serviceCount} services</span>}
        <span>{formatDate(row.startTime)}</span>
      </div>
      {(constants.source === null || constants.endpoint === null || constants.container === null) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {constants.source === null && <SourceBadge source={row.source} />}
          {constants.endpoint === null && (
            <span className="rounded border bg-muted/40 px-1.5 py-0.5">endpoint: {row.endpoint}</span>
          )}
          {constants.container === null && (
            <span className="rounded border bg-muted/40 px-1.5 py-0.5">container: {row.container}</span>
          )}
        </div>
      )}
    </button>
  );
}

export default function TraceExplorerPage() {
  // Deep-link query params from other pages (Workloads, Container Detail,
  // Network Topology). Read once on mount and applied as filter defaults so
  // links land already pre-filtered.
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState(() => searchParams.get('service') ?? '');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'error' | 'anomalous'>(() => {
    const s = searchParams.get('status');
    return s === 'ok' || s === 'error' || s === 'anomalous' ? s : 'all';
  });
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '6h' | '24h' | '7d' | 'all'>('24h');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(() => searchParams.get('trace'));

  // Re-apply deep-link params if the URL changes without remounting (e.g.
  // user clicks a second deep link without leaving the Trace Explorer route).
  // Only the deep-link fields are touched, so a user editing other filters
  // is not disturbed.
  useEffect(() => {
    const s = searchParams.get('service');
    if (s !== null) setServiceFilter(s);
    const status = searchParams.get('status');
    if (status === 'ok' || status === 'error' || status === 'all' || status === 'anomalous') {
      setStatusFilter(status);
    }
    const trace = searchParams.get('trace');
    if (trace !== null) setSelectedTraceId(trace);
  }, [searchParams]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [showServiceMap, setShowServiceMap] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  /** The 25 OTEL attribute filters no operator reaches for, behind a second click. */
  const [showAllAttributeFilters, setShowAllAttributeFilters] = useState(false);
  const [showSourceGuide, setShowSourceGuide] = useState(false);
  const [showPreflights, setShowPreflights] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [textFilterMode, setTextFilterMode] = useState<'exact' | 'contains'>('exact');
  const [httpMethodFilter, setHttpMethodFilter] = useState('');
  const [httpRouteFilter, setHttpRouteFilter] = useState('');
  const [httpStatusCodeFilter, setHttpStatusCodeFilter] = useState('');
  const [serviceNamespaceFilter, setServiceNamespaceFilter] = useState('');
  const [serviceInstanceIdFilter, setServiceInstanceIdFilter] = useState('');
  const [serviceVersionFilter, setServiceVersionFilter] = useState('');
  const [deploymentEnvironmentFilter, setDeploymentEnvironmentFilter] = useState('');
  const [containerIdFilter, setContainerIdFilter] = useState('');
  const [containerNameFilter, setContainerNameFilter] = useState('');
  const [k8sNamespaceFilter, setK8sNamespaceFilter] = useState('');
  const [k8sPodNameFilter, setK8sPodNameFilter] = useState('');
  const [k8sContainerNameFilter, setK8sContainerNameFilter] = useState('');
  const [serverAddressFilter, setServerAddressFilter] = useState('');
  const [serverPortFilter, setServerPortFilter] = useState('');
  const [clientAddressFilter, setClientAddressFilter] = useState('');
  const [urlFullFilter, setUrlFullFilter] = useState('');
  const [urlSchemeFilter, setUrlSchemeFilter] = useState('');
  const [networkTransportFilter, setNetworkTransportFilter] = useState('');
  const [networkProtocolNameFilter, setNetworkProtocolNameFilter] = useState('');
  const [networkProtocolVersionFilter, setNetworkProtocolVersionFilter] = useState('');
  const [netPeerNameFilter, setNetPeerNameFilter] = useState('');
  const [netPeerPortFilter, setNetPeerPortFilter] = useState('');
  const [hostNameFilter, setHostNameFilter] = useState('');
  const [osTypeFilter, setOsTypeFilter] = useState('');
  const [processPidFilter, setProcessPidFilter] = useState('');
  const [processExecutableNameFilter, setProcessExecutableNameFilter] = useState('');
  const [processCommandFilter, setProcessCommandFilter] = useState('');
  const [telemetrySdkNameFilter, setTelemetrySdkNameFilter] = useState('');
  const [telemetrySdkLanguageFilter, setTelemetrySdkLanguageFilter] = useState('');
  const [telemetrySdkVersionFilter, setTelemetrySdkVersionFilter] = useState('');
  const [otelScopeNameFilter, setOtelScopeNameFilter] = useState('');
  const [otelScopeVersionFilter, setOtelScopeVersionFilter] = useState('');

  const fromTime = useMemo(() => getFromIso(timeRange), [timeRange]);

  const traceQuery = useMemo(() => ({
    serviceName: serviceFilter || undefined,
    source: sourceFilter || undefined,
    // `anomalous` is a client-side z-score cut over the loaded window, not a
    // status the API knows about.
    status: statusFilter === 'ok' || statusFilter === 'error' ? statusFilter : undefined,
    from: fromTime,
    limit: 200,
    httpMethod: httpMethodFilter || undefined,
    httpRoute: httpRouteFilter || undefined,
    httpRouteMatch: textFilterMode,
    httpStatusCode: httpStatusCodeFilter ? Number(httpStatusCodeFilter) : undefined,
    serviceNamespace: serviceNamespaceFilter || undefined,
    serviceNamespaceMatch: textFilterMode,
    serviceInstanceId: serviceInstanceIdFilter || undefined,
    serviceVersion: serviceVersionFilter || undefined,
    deploymentEnvironment: deploymentEnvironmentFilter || undefined,
    containerId: containerIdFilter || undefined,
    containerName: containerNameFilter || undefined,
    containerNameMatch: textFilterMode,
    k8sNamespace: k8sNamespaceFilter || undefined,
    k8sNamespaceMatch: textFilterMode,
    k8sPodName: k8sPodNameFilter || undefined,
    k8sContainerName: k8sContainerNameFilter || undefined,
    serverAddress: serverAddressFilter || undefined,
    serverPort: serverPortFilter ? Number(serverPortFilter) : undefined,
    clientAddress: clientAddressFilter || undefined,
    urlFull: urlFullFilter || undefined,
    urlFullMatch: textFilterMode,
    urlScheme: urlSchemeFilter || undefined,
    networkTransport: networkTransportFilter || undefined,
    networkProtocolName: networkProtocolNameFilter || undefined,
    networkProtocolVersion: networkProtocolVersionFilter || undefined,
    netPeerName: netPeerNameFilter || undefined,
    netPeerNameMatch: textFilterMode,
    netPeerPort: netPeerPortFilter ? Number(netPeerPortFilter) : undefined,
    hostName: hostNameFilter || undefined,
    hostNameMatch: textFilterMode,
    osType: osTypeFilter || undefined,
    processPid: processPidFilter ? Number(processPidFilter) : undefined,
    processExecutableName: processExecutableNameFilter || undefined,
    processExecutableNameMatch: textFilterMode,
    processCommand: processCommandFilter || undefined,
    processCommandMatch: textFilterMode,
    telemetrySdkName: telemetrySdkNameFilter || undefined,
    telemetrySdkLanguage: telemetrySdkLanguageFilter || undefined,
    telemetrySdkVersion: telemetrySdkVersionFilter || undefined,
    otelScopeName: otelScopeNameFilter || undefined,
    otelScopeVersion: otelScopeVersionFilter || undefined,
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
    serviceInstanceIdFilter,
    serviceVersionFilter,
    deploymentEnvironmentFilter,
    containerIdFilter,
    containerNameFilter,
    k8sNamespaceFilter,
    k8sPodNameFilter,
    k8sContainerNameFilter,
    serverAddressFilter,
    serverPortFilter,
    clientAddressFilter,
    urlFullFilter,
    urlSchemeFilter,
    networkTransportFilter,
    networkProtocolNameFilter,
    networkProtocolVersionFilter,
    netPeerNameFilter,
    netPeerPortFilter,
    hostNameFilter,
    osTypeFilter,
    processPidFilter,
    processExecutableNameFilter,
    processCommandFilter,
    telemetrySdkNameFilter,
    telemetrySdkLanguageFilter,
    telemetrySdkVersionFilter,
    otelScopeNameFilter,
    otelScopeVersionFilter,
  ]);

  const { data: tracesData, isLoading: tracesLoading, isPending: tracesPending, isError, error, refetch, isFetching, dataUpdatedAt } = useTraces(traceQuery);
  const { data: selectedTraceData } = useTrace(selectedTraceId || undefined);
  const { data: serviceMapData } = useServiceMap(traceQuery);
  const { data: summary } = useTraceSummary(traceQuery);

  // The hook owns the timer. Without `onTick` the interval dropdown rendered a
  // live indicator over a schedule that fetched nothing.
  const { interval, setRefreshInterval } = useAutoRefresh(0, {
    onTick: () => { void refetch(); },
    storageKey: 'traces',
  });

  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = tracesLoading || (tracesPending && !tracesData);

  // useTraces unwraps the { traces } envelope, so tracesData is always an array.
  const traces = useMemo(() => tracesData ?? [], [tracesData]) as Array<{
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
        http_route?: string | null;
        url_full?: string | null;
        server_address?: string | null;
        server_port?: number | null;
        client_address?: string | null;
        url_scheme?: string | null;
        network_transport?: string | null;
        network_protocol_name?: string | null;
        network_protocol_version?: string | null;
        net_peer_name?: string | null;
        net_peer_port?: number | null;
        host_name?: string | null;
        os_type?: string | null;
        process_pid?: number | null;
        process_executable_name?: string | null;
        process_command?: string | null;
        telemetry_sdk_name?: string | null;
        telemetry_sdk_language?: string | null;
        telemetry_sdk_version?: string | null;
        otel_scope_name?: string | null;
        otel_scope_version?: string | null;
        service_namespace?: string | null;
        service_instance_id?: string | null;
        service_version?: string | null;
        deployment_environment?: string | null;
        container_id?: string | null;
        container_name?: string | null;
        k8s_namespace?: string | null;
        k8s_pod_name?: string | null;
        k8s_container_name?: string | null;
        attributes?: unknown;
      }>;
    };
    if (!data.spans) return null;

    const normalizedSpans = data.spans.map((s) => {
      const attrs = parseAttributes(s.attributes);
      return {
        spanId: s.spanId || s.span_id || '',
        traceId: s.traceId || s.trace_id || data.traceId || '',
        parentSpanId: s.parentSpanId || s.parent_span_id,
        operationName: s.operationName || s.name || '',
        serviceName: s.serviceName || s.service_name || 'unknown',
        serviceNamespace: getFirstString(s.service_namespace, getAttrString(attrs, ['service.namespace'])) || 'unknown',
        serviceInstance: getFirstString(s.service_instance_id, getAttrString(attrs, ['service.instance.id'])) || 'unknown',
        serviceVersion: getFirstString(s.service_version, getAttrString(attrs, ['service.version'])) || 'unknown',
        deploymentEnvironment: getFirstString(s.deployment_environment, getAttrString(attrs, ['deployment.environment'])) || 'unknown',
        startTime: s.startTime || s.start_time || '',
        endTime: s.endTime || s.end_time || null,
        duration: s.duration ?? s.duration_ms ?? 0,
        kind: s.kind || 'internal',
        status: s.status,
        source: getSpanSource(s.trace_source, attrs),
        endpoint: getSpanEndpoint(s as Record<string, unknown>, attrs),
        serverAddress: getFirstString(s.server_address, getAttrString(attrs, ['server.address', 'net.host.name', 'host.name'])) || 'unknown',
        serverPort: s.server_port ?? getAttrNumber(attrs, ['server.port', 'net.host.port']),
        clientAddress: getFirstString(s.client_address, getAttrString(attrs, ['client.address', 'net.sock.peer.addr'])) || 'unknown',
        urlFull: getFirstString(s.url_full, getAttrString(attrs, ['url.full', 'http.url'])) || 'unknown',
        urlScheme: getFirstString(s.url_scheme, getAttrString(attrs, ['url.scheme'])) || 'unknown',
        networkTransport: getFirstString(s.network_transport, getAttrString(attrs, ['network.transport'])) || 'unknown',
        networkProtocolName: getFirstString(s.network_protocol_name, getAttrString(attrs, ['network.protocol.name'])) || 'unknown',
        networkProtocolVersion: getFirstString(s.network_protocol_version, getAttrString(attrs, ['network.protocol.version'])) || 'unknown',
        netPeerName: getFirstString(s.net_peer_name, getAttrString(attrs, ['net.peer.name'])) || 'unknown',
        netPeerPort: s.net_peer_port ?? getAttrNumber(attrs, ['net.peer.port']),
        hostName: getFirstString(s.host_name, getAttrString(attrs, ['host.name'])) || 'unknown',
        osType: getFirstString(s.os_type, getAttrString(attrs, ['os.type'])) || 'unknown',
        processPid: s.process_pid ?? getAttrNumber(attrs, ['process.pid']),
        processExecutableName: getFirstString(s.process_executable_name, getAttrString(attrs, ['process.executable.name'])) || 'unknown',
        processCommand: getFirstString(s.process_command, getAttrString(attrs, ['process.command_line', 'process.command'])) || 'unknown',
        telemetrySdkName: getFirstString(s.telemetry_sdk_name, getAttrString(attrs, ['telemetry.sdk.name'])) || 'unknown',
        telemetrySdkLanguage: getFirstString(s.telemetry_sdk_language, getAttrString(attrs, ['telemetry.sdk.language'])) || 'unknown',
        telemetrySdkVersion: getFirstString(s.telemetry_sdk_version, getAttrString(attrs, ['telemetry.sdk.version'])) || 'unknown',
        otelScopeName: getFirstString(s.otel_scope_name, getAttrString(attrs, ['otel.scope.name', 'otel.library.name'])) || 'unknown',
        otelScopeVersion: getFirstString(s.otel_scope_version, getAttrString(attrs, ['otel.scope.version'])) || 'unknown',
        containerId: getFirstString(s.container_id, getAttrString(attrs, ['container.id'])) || 'unknown',
        container: getSpanContainer(s as Record<string, unknown>, attrs),
        k8sNamespace: getFirstString(s.k8s_namespace, getAttrString(attrs, ['k8s.namespace.name'])) || 'unknown',
        k8sPodName: getFirstString(s.k8s_pod_name, getAttrString(attrs, ['k8s.pod.name'])) || 'unknown',
        k8sContainerName: getFirstString(s.k8s_container_name, getAttrString(attrs, ['k8s.container.name'])) || 'unknown',
        attributes: attrs,
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

  // p50/p95 and the z-score baseline are measured over the whole loaded
  // window, not the current status cut — otherwise selecting "Anomalous"
  // would redefine the population it is measured against.
  const durationStats = useMemo(
    () => computeDurationStats(traces.map((t) => t.duration ?? t.duration_ms ?? 0)),
    [traces],
  );

  const traceRows = useMemo<TraceRow[]>(() => {
    return traces.map((trace) => {
      const duration = trace.duration ?? trace.duration_ms ?? 0;
      const operation = trace.root_span || trace.rootSpan?.operationName || 'Unknown operation';
      return {
        id: trace.traceId || trace.trace_id || '',
        status: trace.status,
        duration,
        operation,
        service: trace.serviceName || trace.service_name || trace.rootSpan?.serviceName || 'Unknown',
        source: trace.trace_source || 'unknown',
        endpoint: getTraceEndpointLabel(trace as Record<string, unknown>),
        container: getTraceContainerLabel(trace as Record<string, unknown>),
        spanCount: trace.span_count ?? trace.spans?.length ?? 0,
        serviceCount: trace.services?.length ?? 1,
        startTime: trace.startTime || trace.start_time || '',
        isPreflight: isPreflightOperation(operation),
        zScore: durationZScore(duration, durationStats),
      };
    });
  }, [traces, durationStats]);

  const filteredRows = useMemo(() => {
    return traceRows.filter((row) => {
      if (statusFilter === 'anomalous') {
        if (row.zScore === null || row.zScore < ANOMALY_Z_THRESHOLD) return false;
      } else if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (!searchQuery) return true;

      const q = searchQuery.toLowerCase();
      return (
        row.id.toLowerCase().includes(q)
        || row.service.toLowerCase().includes(q)
        || row.operation.toLowerCase().includes(q)
      );
    });
  }, [traceRows, searchQuery, statusFilter]);

  const anomalousCount = useMemo(
    () => traceRows.filter((r) => r.zScore !== null && r.zScore >= ANOMALY_Z_THRESHOLD).length,
    [traceRows],
  );

  const preflightRows = useMemo(() => filteredRows.filter((r) => r.isPreflight), [filteredRows]);

  /** CORS preflights collapse into one aggregated row unless asked for. */
  const visibleRows = useMemo(
    () => (showPreflights ? filteredRows : filteredRows.filter((r) => !r.isPreflight)),
    [filteredRows, showPreflights],
  );

  // A field that reads the same on every row is 100% ink for 0 bits. Render it
  // once above the list instead of once per card.
  const constantFields = useMemo<ConstantFields>(() => ({
    service: constantValue(filteredRows.map((r) => r.service)),
    source: constantValue(filteredRows.map((r) => r.source)),
    endpoint: constantValue(filteredRows.map((r) => r.endpoint)),
    container: constantValue(filteredRows.map((r) => r.container)),
    serviceCount: constantValue(filteredRows.map((r) => String(r.serviceCount))),
  }), [filteredRows]);

  // Virtualized like the Log Viewer. The list is capped at 200 today but
  // unbounded in shape, and it renders ~11 nodes per card.
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => TRACE_ROW_ESTIMATED_HEIGHT,
    overscan: 8,
  });

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
    httpMethodFilter
    || httpRouteFilter
    || httpStatusCodeFilter
    || serviceNamespaceFilter
    || serviceInstanceIdFilter
    || serviceVersionFilter
    || deploymentEnvironmentFilter
    || containerIdFilter
    || containerNameFilter
    || k8sNamespaceFilter
    || k8sPodNameFilter
    || k8sContainerNameFilter
    || serverAddressFilter
    || serverPortFilter
    || clientAddressFilter
    || urlFullFilter
    || urlSchemeFilter
    || networkTransportFilter
    || networkProtocolNameFilter
    || networkProtocolVersionFilter
    || netPeerNameFilter
    || netPeerPortFilter
    || hostNameFilter
    || osTypeFilter
    || processPidFilter
    || processExecutableNameFilter
    || processCommandFilter
    || telemetrySdkNameFilter
    || telemetrySdkLanguageFilter
    || telemetrySdkVersionFilter
    || otelScopeNameFilter
    || otelScopeVersionFilter
    || textFilterMode !== 'exact'
  );

  /**
   * The one stat line. This was four KPI tiles, and the headline number was
   * `Avg Duration` — the statistic the anomaly detector does not use.
   */
  const statLine = summary ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
      <span>{summary.totalTraces} traces</span>
      <span aria-hidden="true">·</span>
      <span>{summary.services} {summary.services === 1 ? 'service' : 'services'}</span>
      <span aria-hidden="true">·</span>
      <span>{(summary.errorRate * 100).toFixed(1)}% errors</span>
      <span aria-hidden="true">·</span>
      <span title={`p95 and p50 over the ${durationStats.count} traces loaded into the list.`}>
        p95 {formatDuration(durationStats.p95)} · p50 {formatDuration(durationStats.p50)}
      </span>
    </span>
  ) : undefined;

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Traces" />
        <EmptyState
          variant="error"
          icon={AlertTriangle}
          title="Failed to load traces"
          description={error instanceof Error ? error.message : 'An unexpected error occurred'}
        />
        <button
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traces"
        subtitle={statLine}
        hideSubtitleOnMobile={false}
        actions={
          <>
            <DataFreshness lastUpdated={dataUpdatedAt || null} onRefresh={() => refetch()} />
            <button
              type="button"
              onClick={() => setShowSourceGuide((prev) => !prev)}
              aria-expanded={showSourceGuide}
              aria-controls="trace-source-guide"
              className="rounded-md border border-input bg-background p-2 hover:bg-muted"
              data-testid="source-guide-toggle"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Trace sources and percentiles</span>
            </button>
            <RefreshControls interval={interval} onIntervalChange={setRefreshInterval} onRefresh={() => refetch()} isLoading={isFetching} />
          </>
        }
      />

      {showSourceGuide && (
        <div
          id="trace-source-guide"
          className="space-y-2 rounded-lg border bg-card p-4 text-xs text-muted-foreground"
        >
          <p className="font-medium text-foreground">How these numbers are computed</p>
          <p>
            <code>source: ebpf</code> means Beyla captured runtime network spans.{' '}
            <code>kind=server</code> is inbound traffic, <code>kind=client</code> is outbound
            calls, and <code>kind=internal</code> is in-process work. If endpoint/container is{' '}
            <code>unknown</code>, instrumentation still works but metadata enrichment is missing.
          </p>
          <p>
            Ingested in this window: {SOURCE_LABELS.ebpf} {sourceCounts.ebpf} · {SOURCE_LABELS.http} {sourceCounts.http} · {SOURCE_LABELS.scheduler} {sourceCounts.scheduler} · {SOURCE_LABELS.unknown} {sourceCounts.unknown}.
          </p>
          <p>
            p95 and p50 are computed from the {durationStats.count} traces loaded into the list (up to 200), not from the full result set. Anomalous selects traces at least {ANOMALY_Z_THRESHOLD} standard deviations above that window&apos;s mean duration — the threshold the trace detector applies to latency p95 (<code>TRACES_ANOMALY_P95_ZSCORE</code>, default {ANOMALY_Z_THRESHOLD.toFixed(1)}).
          </p>
        </div>
      )}

      <SpotlightCard>
      <div className="space-y-3 rounded-lg border bg-card p-6 shadow-sm">
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

          <div className="flex flex-wrap items-center gap-2" data-testid="source-filter">
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <SourceFilterChip
              source="all"
              active={sourceFilter === ''}
              onSelect={() => setSourceFilter('')}
            />
            {FILTERABLE_SOURCES.map((source) => (
              <SourceFilterChip
                key={source}
                source={source}
                count={sourceCounts[source]}
                active={sourceFilter === source}
                onSelect={() => setSourceFilter(sourceFilter === source ? '' : source)}
              />
            ))}
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
              {(['all', 'ok', 'error', 'anomalous'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  aria-pressed={statusFilter === status}
                  title={
                    status === 'anomalous'
                      ? `Duration at least ${ANOMALY_Z_THRESHOLD} standard deviations above the mean of the ${durationStats.count} loaded traces — the z-score threshold the trace detector applies to latency p95 (TRACES_ANOMALY_P95_ZSCORE, default ${ANOMALY_Z_THRESHOLD.toFixed(1)}).`
                      : undefined
                  }
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium transition-colors',
                    statusFilter === status
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-muted'
                  )}
                >
                  {status === 'all' ? 'All' : status === 'ok' ? 'Success' : status === 'error' ? 'Error' : `Anomalous (${anomalousCount})`}
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
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {showAdvancedFilters ? 'Hide advanced filters' : 'Show advanced filters'}
            </button>
          </div>
          {hasAdvancedFiltersApplied && (
            <button
              type="button"
              onClick={() => {
                setHttpMethodFilter('');
                setHttpRouteFilter('');
                setHttpStatusCodeFilter('');
                setServiceNamespaceFilter('');
                setServiceInstanceIdFilter('');
                setServiceVersionFilter('');
                setDeploymentEnvironmentFilter('');
                setContainerIdFilter('');
                setContainerNameFilter('');
                setK8sNamespaceFilter('');
                setK8sPodNameFilter('');
                setK8sContainerNameFilter('');
                setServerAddressFilter('');
                setServerPortFilter('');
                setClientAddressFilter('');
                setUrlFullFilter('');
                setUrlSchemeFilter('');
                setNetworkTransportFilter('');
                setNetworkProtocolNameFilter('');
                setNetworkProtocolVersionFilter('');
                setNetPeerNameFilter('');
                setNetPeerPortFilter('');
                setHostNameFilter('');
                setOsTypeFilter('');
                setProcessPidFilter('');
                setProcessExecutableNameFilter('');
                setProcessCommandFilter('');
                setTelemetrySdkNameFilter('');
                setTelemetrySdkLanguageFilter('');
                setTelemetrySdkVersionFilter('');
                setOtelScopeNameFilter('');
                setOtelScopeVersionFilter('');
                setTextFilterMode('exact');
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear advanced filters
            </button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="space-y-3 rounded-md border bg-background/60 p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              Host Name
              <input
                type="text"
                value={hostNameFilter}
                onChange={(e) => setHostNameFilter(e.target.value)}
                placeholder="srv-edge-01"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>

          {/* The remaining OTEL semantic-convention attributes. They were all
              rendered at once — 31 form fields, most with a single possible
              value on a one-service fleet. */}
          <button
            type="button"
            onClick={() => setShowAllAttributeFilters((prev) => !prev)}
            className="text-xs font-medium text-primary hover:underline"
            data-testid="toggle-attribute-filters"
          >
            {showAllAttributeFilters ? 'Hide OTEL attribute filters' : 'Show OTEL attribute filters (26)'}
          </button>

          {showAllAttributeFilters && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              Service Instance ID
              <input
                type="text"
                value={serviceInstanceIdFilter}
                onChange={(e) => setServiceInstanceIdFilter(e.target.value)}
                placeholder="srv-edge-01"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Service Version
              <input
                type="text"
                value={serviceVersionFilter}
                onChange={(e) => setServiceVersionFilter(e.target.value)}
                placeholder="1.2.3"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Deployment Environment
              <input
                type="text"
                value={deploymentEnvironmentFilter}
                onChange={(e) => setDeploymentEnvironmentFilter(e.target.value)}
                placeholder="production"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Container ID
              <input
                type="text"
                value={containerIdFilter}
                onChange={(e) => setContainerIdFilter(e.target.value)}
                placeholder="f6b71bc8bca2"
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

            <label className="text-xs text-muted-foreground">
              K8s Pod Name
              <input
                type="text"
                value={k8sPodNameFilter}
                onChange={(e) => setK8sPodNameFilter(e.target.value)}
                placeholder="payments-api-6f9d95"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              K8s Container Name
              <input
                type="text"
                value={k8sContainerNameFilter}
                onChange={(e) => setK8sContainerNameFilter(e.target.value)}
                placeholder="api"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Server Address
              <input
                type="text"
                value={serverAddressFilter}
                onChange={(e) => setServerAddressFilter(e.target.value)}
                placeholder="10.0.0.24"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Server Port
              <input
                type="number"
                value={serverPortFilter}
                onChange={(e) => setServerPortFilter(e.target.value)}
                placeholder="443"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Client Address
              <input
                type="text"
                value={clientAddressFilter}
                onChange={(e) => setClientAddressFilter(e.target.value)}
                placeholder="10.0.0.12"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              URL Full
              <input
                type="text"
                value={urlFullFilter}
                onChange={(e) => setUrlFullFilter(e.target.value)}
                placeholder="http://service:8080/path"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              URL Scheme
              <input
                type="text"
                value={urlSchemeFilter}
                onChange={(e) => setUrlSchemeFilter(e.target.value)}
                placeholder="http"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Network Transport
              <input
                type="text"
                value={networkTransportFilter}
                onChange={(e) => setNetworkTransportFilter(e.target.value)}
                placeholder="tcp"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Network Protocol Name
              <input
                type="text"
                value={networkProtocolNameFilter}
                onChange={(e) => setNetworkProtocolNameFilter(e.target.value)}
                placeholder="http"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Network Protocol Version
              <input
                type="text"
                value={networkProtocolVersionFilter}
                onChange={(e) => setNetworkProtocolVersionFilter(e.target.value)}
                placeholder="1.1"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Net Peer Name
              <input
                type="text"
                value={netPeerNameFilter}
                onChange={(e) => setNetPeerNameFilter(e.target.value)}
                placeholder="api.internal.local"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Net Peer Port
              <input
                type="number"
                value={netPeerPortFilter}
                onChange={(e) => setNetPeerPortFilter(e.target.value)}
                placeholder="443"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              OS Type
              <input
                type="text"
                value={osTypeFilter}
                onChange={(e) => setOsTypeFilter(e.target.value)}
                placeholder="linux"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Process PID
              <input
                type="number"
                value={processPidFilter}
                onChange={(e) => setProcessPidFilter(e.target.value)}
                placeholder="12345"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Process Executable Name
              <input
                type="text"
                value={processExecutableNameFilter}
                onChange={(e) => setProcessExecutableNameFilter(e.target.value)}
                placeholder="http-echo"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Process Command
              <input
                type="text"
                value={processCommandFilter}
                onChange={(e) => setProcessCommandFilter(e.target.value)}
                placeholder="/bin/http-echo --port 8080"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Telemetry SDK Name
              <input
                type="text"
                value={telemetrySdkNameFilter}
                onChange={(e) => setTelemetrySdkNameFilter(e.target.value)}
                placeholder="beyla"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Telemetry SDK Language
              <input
                type="text"
                value={telemetrySdkLanguageFilter}
                onChange={(e) => setTelemetrySdkLanguageFilter(e.target.value)}
                placeholder="go"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              Telemetry SDK Version
              <input
                type="text"
                value={telemetrySdkVersionFilter}
                onChange={(e) => setTelemetrySdkVersionFilter(e.target.value)}
                placeholder="2.8.5"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              OTEL Scope Name
              <input
                type="text"
                value={otelScopeNameFilter}
                onChange={(e) => setOtelScopeNameFilter(e.target.value)}
                placeholder="github.com/grafana/beyla"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              OTEL Scope Version
              <input
                type="text"
                value={otelScopeVersionFilter}
                onChange={(e) => setOtelScopeVersionFilter(e.target.value)}
                placeholder="v2.8.5"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
          )}
          </div>
        )}
      </div>
      </SpotlightCard>

      {showServiceMap && (
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">Service Dependency Map</h3>
          <ServiceMap serviceNodes={serviceMapNodes} serviceEdges={serviceMapEdges} />
        </div>
        </SpotlightCard>
      )}

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <SkeletonList rows={4} className="h-[600px]" />
          <div className="lg:col-span-2">
            <SkeletonChart size="lg" className="h-[600px]" />
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No traces found"
          description={
            searchQuery || serviceFilter || sourceFilter || statusFilter !== 'all' || hasAdvancedFiltersApplied
              ? 'Try adjusting your search or filter criteria.'
              : 'No distributed traces have been collected yet.'
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-2">
            {/* Fields identical on every row are stated once here instead of
                being reprinted on each card.

                The count is "These N of M", not "All N": the list is capped at
                200 while thousands can match, and over a 200-row page "All"
                made a claim about the whole result set. An operator read
                `container: unknown` here and concluded the fleet had no
                container attribution at all. CLAUDE.md invariant 6 — a capped
                list travels with its real count — applies to the sentence
                describing the list just as much as to the list. */}
            {(constantFields.service
              || constantFields.source
              || constantFields.endpoint
              || constantFields.container) && (
              <p className="text-xs text-muted-foreground" data-testid="constant-fields">
                {summary && summary.totalTraces > filteredRows.length
                  ? `These ${filteredRows.length} of ${summary.totalTraces} traces:`
                  : `All ${filteredRows.length} traces:`}{' '}
                {[
                  constantFields.service,
                  constantFields.source && `source: ${SOURCE_LABELS[normalizeSource(constantFields.source)]}`,
                  constantFields.endpoint && `endpoint: ${constantFields.endpoint}`,
                  constantFields.container && `container: ${constantFields.container}`,
                ].filter(Boolean).join(' · ')}
              </p>
            )}

            {preflightRows.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPreflights((prev) => !prev)}
                aria-expanded={showPreflights}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/60"
                data-testid="preflight-summary"
              >
                <span>
                  {preflightRows.length} CORS preflight {preflightRows.length === 1 ? 'trace' : 'traces'} (OPTIONS) · p95{' '}
                  {formatDuration(computeDurationStats(preflightRows.map((r) => r.duration)).p95)}
                </span>
                <span className="font-medium text-primary">{showPreflights ? 'Hide' : 'Show'}</span>
              </button>
            )}

            <div
              ref={listScrollRef}
              className="h-[calc(100vh-22rem)] min-h-[420px] overflow-y-auto pr-2"
              data-testid="trace-list"
            >
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = visibleRows[virtualRow.index];
                  if (!row) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="pb-3"
                    >
                      <TraceListItem
                        row={row}
                        constants={constantFields}
                        isSelected={selectedTraceId === row.id}
                        onClick={() => {
                          setSelectedTraceId(row.id);
                          setSelectedSpanId(null);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedTraceId && selectedTrace ? (
              <SpotlightCard>
              <div className="rounded-lg border bg-card shadow-sm">
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
                    <SourceBadge source={selectedTrace.source} />
                    <span className="rounded border bg-muted/40 px-1.5 py-0.5">endpoint: {selectedTrace.endpoint}</span>
                    <span className="rounded border bg-muted/40 px-1.5 py-0.5">container: {selectedTrace.container}</span>
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
                        <div>
                          <p className="text-xs text-muted-foreground">Trace ID</p>
                          <p className="font-mono text-xs">{selectedSpan.traceId}</p>
                        </div>
                        {selectedSpan.parentSpanId && (
                          <div>
                            <p className="text-xs text-muted-foreground">Parent Span</p>
                            <p className="font-mono text-xs">{selectedSpan.parentSpanId}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground">Kind</p>
                          <p className="font-medium" title={getSpanKindDescription(selectedSpan.kind)}>{selectedSpan.kind}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Service Namespace</p>
                          <p className="font-medium">{selectedSpan.serviceNamespace}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Service Instance</p>
                          <p className="font-medium">{selectedSpan.serviceInstance}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Service Version</p>
                          <p className="font-medium">{selectedSpan.serviceVersion}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Deployment Environment</p>
                          <p className="font-medium">{selectedSpan.deploymentEnvironment}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Source</p>
                          <SourceBadge source={selectedSpan.source} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Endpoint</p>
                          <p className="font-medium">{selectedSpan.endpoint}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Container</p>
                          <p className="font-medium">{selectedSpan.container}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Container ID</p>
                          <p className="font-medium">{selectedSpan.containerId}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">K8s Namespace</p>
                          <p className="font-medium">{selectedSpan.k8sNamespace}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">K8s Pod</p>
                          <p className="font-medium">{selectedSpan.k8sPodName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">K8s Container</p>
                          <p className="font-medium">{selectedSpan.k8sContainerName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Server Address</p>
                          <p className="font-medium">{selectedSpan.serverAddress}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Server Port</p>
                          <p className="font-medium">{selectedSpan.serverPort ?? 'unknown'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Client Address</p>
                          <p className="font-medium">{selectedSpan.clientAddress}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">URL Full</p>
                          <p className="font-medium">{selectedSpan.urlFull}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">URL Scheme</p>
                          <p className="font-medium">{selectedSpan.urlScheme}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Network Transport</p>
                          <p className="font-medium">{selectedSpan.networkTransport}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Network Protocol Name</p>
                          <p className="font-medium">{selectedSpan.networkProtocolName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Network Protocol Version</p>
                          <p className="font-medium">{selectedSpan.networkProtocolVersion}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Net Peer Name</p>
                          <p className="font-medium">{selectedSpan.netPeerName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Net Peer Port</p>
                          <p className="font-medium">{selectedSpan.netPeerPort ?? 'unknown'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Host Name</p>
                          <p className="font-medium">{selectedSpan.hostName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">OS Type</p>
                          <p className="font-medium">{selectedSpan.osType}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Process PID</p>
                          <p className="font-medium">{selectedSpan.processPid ?? 'unknown'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Process Executable</p>
                          <p className="font-medium">{selectedSpan.processExecutableName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Process Command</p>
                          <p className="font-medium break-all">{selectedSpan.processCommand}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Telemetry SDK Name</p>
                          <p className="font-medium">{selectedSpan.telemetrySdkName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Telemetry SDK Language</p>
                          <p className="font-medium">{selectedSpan.telemetrySdkLanguage}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Telemetry SDK Version</p>
                          <p className="font-medium">{selectedSpan.telemetrySdkVersion}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">OTEL Scope Name</p>
                          <p className="font-medium">{selectedSpan.otelScopeName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">OTEL Scope Version</p>
                          <p className="font-medium">{selectedSpan.otelScopeVersion}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Start / End</p>
                          <p className="font-medium">{formatDate(selectedSpan.startTime)} / {selectedSpan.endTime ? formatDate(selectedSpan.endTime) : 'unknown'}</p>
                        </div>
                      </div>

                      {/* Trace ↔ logs correlation (#1238) — deep-link to the logs viewer
                          pre-filtered by trace id and time window. */}
                      {selectedSpan.traceId && selectedSpan.containerId && selectedSpan.containerId !== 'unknown' && (
                        <div className="pt-2">
                          <a
                            href={`/logs?${new URLSearchParams({
                              containerId: selectedSpan.containerId,
                              trace: selectedSpan.traceId,
                              from: selectedSpan.startTime,
                              to: new Date(
                                (selectedSpan.endTime ? new Date(selectedSpan.endTime).getTime() : new Date(selectedSpan.startTime).getTime() + selectedSpan.duration) + 2000,
                              ).toISOString(),
                            }).toString()}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
                            data-testid="view-logs-link"
                          >
                            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                            View logs for this span
                          </a>
                        </div>
                      )}

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
              </SpotlightCard>
            ) : (
              <EmptyState
                icon={ChevronRight}
                title="Select a trace to view details"
                description="Pick a trace from the list to inspect its spans, timing, and metadata."
                className="h-[600px] justify-center"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
