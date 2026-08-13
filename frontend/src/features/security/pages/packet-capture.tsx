import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radio,
  Play,
  Square,
  Download,
  Trash2,
  Clock,
  Brain,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ShieldAlert,
  Gauge,
  Info,
  Loader2,
} from 'lucide-react';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { DataTable, type ColumnDef } from '@/shared/components/tables/data-table';
import { RefreshButton } from '@/shared/components/ui/refresh-button';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useContainers } from '@/features/containers/hooks/use-containers';
import { useStacks } from '@/features/containers/hooks/use-stacks';
import {
  useCaptures,
  usePcapStatus,
  useStartCapture,
  useStopCapture,
  useDeleteCapture,
  useAnalyzeCapture,
  downloadCapture,
  type Capture,
  type PcapAnalysisResult,
  type PcapFinding,
} from '@/features/security/hooks/use-pcap';
import { CaptureTargetPicker, type CaptureTarget } from '@/features/security/components/capture-target-picker';
import { CaptureBrowseFallback } from '@/features/security/components/capture-browse-fallback';
import { BpfFilterInput } from '@/features/security/components/bpf-filter-input';
import { PageHeader } from '@/shared/components/layout/page-header';
import { findDestination } from '@/features/core/lib/navigation-manifest';
import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

const PAGE_TITLE = findDestination('/packet-capture')?.label ?? 'Packet Capture';

/** Every mutating pcap route is `requireRole('admin')` on the backend. */
const NOT_ADMIN_REASON = 'Requires the admin role';

/**
 * `GET /api/pcap/status` has not answered yet, so whether the feature is on is
 * genuinely unknown. `usePcapStatus` is `staleTime: Infinity`, so this is one
 * request per session rather than a recurring wait.
 */
const PCAP_STATUS_PENDING_REASON = 'Checking whether packet capture is enabled…';

/** The status request failed, so "not yet known" is permanent, not a wait. */
const PCAP_STATUS_FAILED_REASON =
  'Cannot tell whether packet capture is enabled — the status request failed';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '-';
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Four groups, not five raw enum values.
 *
 * The tab row used to expose **Complete** and **Succeeded** as separate
 * filters while the page's own action logic treated them as synonyms
 * (`status === 'complete' || status === 'succeeded'`). An internal enum
 * duplication was handed to the operator, who had no way to know which tab
 * their capture would land in. The grouping now lives in one place and the
 * action logic reads from it.
 */
export type CaptureStatusGroup = 'running' | 'finished' | 'failed';

export function captureStatusGroup(status: Capture['status']): CaptureStatusGroup {
  switch (status) {
    case 'pending':
    case 'capturing':
    case 'processing':
      return 'running';
    case 'complete':
    case 'succeeded':
      return 'finished';
    default:
      return 'failed';
  }
}

export function filterCapturesByGroup(
  captures: Capture[],
  group: CaptureStatusGroup | 'all',
): Capture[] {
  if (group === 'all') return captures;
  return captures.filter((c) => captureStatusGroup(c.status) === group);
}

const STATUS_TABS: { label: string; value: CaptureStatusGroup | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Finished', value: 'finished' },
  { label: 'Failed', value: 'failed' },
];

export default function PacketCapture() {
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const [bpfFilter, setBpfFilter] = useState('');
  const [duration, setDuration] = useState('60');
  const [maxPackets, setMaxPackets] = useState('');
  const [statusFilter, setStatusFilter] = useState<CaptureStatusGroup | 'all'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(historySearch), 300);
    return () => clearTimeout(t);
  }, [historySearch]);

  const { data: endpoints } = useEndpoints();
  const { data: containers } = useContainers({ state: 'running' });
  const { data: stacks } = useStacks();
  // The status tabs are groups, not raw enum values, so the narrowing happens
  // here rather than as a server-side `status=` that can only match one value.
  const { data: pcapStatus, isError: pcapStatusFailed } = usePcapStatus();
  const { data: capturesData, refetch, isFetching } = useCaptures({
    search: debouncedSearch || undefined,
  });
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<string>>(new Set());
  const startCapture = useStartCapture();
  const stopCapture = useStopCapture();
  const deleteCapture = useDeleteCapture();
  const analyzeMutation = useAnalyzeCapture();

  const { role } = useAuth();
  const canCapture = role === 'admin';

  const allCaptures = capturesData?.captures ?? [];
  const captures = useMemo(
    () => filterCapturesByGroup(allCaptures, statusFilter),
    [allCaptures, statusFilter],
  );
  const activeCaptures = allCaptures.filter((c) => captureStatusGroup(c.status) === 'running');
  const hasAnyCaptures = allCaptures.length > 0;
  const edgeAsyncEndpointIds = useMemo(
    () => new Set((endpoints ?? []).filter((e) => e.edgeMode === 'async').map((e) => e.id)),
    [endpoints],
  );
  const endpointNameById = useMemo(
    () => new Map((endpoints ?? []).map((e) => [e.id, e.name])),
    [endpoints],
  );
  // useContainers({ state: 'running' }) already filters server-side, so this is
  // just a stable [] fallback for the picker/fallback props.
  const runningContainers = containers ?? [];
  const targetIsEdgeAsync = target ? edgeAsyncEndpointIds.has(target.endpointId) : false;

  /**
   * Why Start is disabled, or `null` when it is not. A disabled primary that
   * never says why is a dead end — the operator cannot tell whether the button
   * is broken or whether they have missed a step.
   */
  // The feature flag comes first: every other precondition is about *this*
  // capture, and none of them matter if capture is switched off for the whole
  // deployment. That branch was missing entirely, so the button was live on a
  // stock install and the click ate a server error.
  //
  // "Not yet known" is not "enabled" either. `pcapStatus` is undefined while
  // the status request is in flight, and a `pcapStatus && !pcapStatus.enabled`
  // guard skips the whole flag branch in that window — leaving the reason null
  // and the button live in exactly the state a stock install starts in, which
  // the click-time guard cannot fix because the reason is null there too.
  const startDisabledReason: string | null = !pcapStatus
    ? (pcapStatusFailed ? PCAP_STATUS_FAILED_REASON : PCAP_STATUS_PENDING_REASON)
    : !pcapStatus.enabled
      ? (pcapStatus.disabledReason ?? 'Packet capture is not enabled for this deployment')
      : !canCapture
        ? NOT_ADMIN_REASON
        : !target
          ? 'Select a target container'
          : targetIsEdgeAsync
            ? 'Edge Async endpoints cannot run docker exec'
            : null;

  const handleStartCapture = () => {
    if (startDisabledReason !== null) return;
    if (!target || targetIsEdgeAsync || !canCapture) return;

    startCapture.mutate({
      endpointId: target.endpointId,
      containerId: target.containerId,
      containerName: target.containerName,
      filter: bpfFilter || undefined,
      durationSeconds: duration ? parseInt(duration, 10) : undefined,
      maxPackets: maxPackets ? parseInt(maxPackets, 10) : undefined,
    });
  };

  const stopMutate = stopCapture.mutate;
  const deleteMutate = deleteCapture.mutate;
  const analyzeMutate = analyzeMutation.mutate;
  const analyzePending = analyzeMutation.isPending;
  const analyzeVariables = analyzeMutation.variables;

  const handleStop = useCallback((id: string) => stopMutate(id), [stopMutate]);
  const handleDelete = useCallback((id: string) => deleteMutate(id), [deleteMutate]);
  const handleDownload = useCallback((id: string) => downloadCapture(id), []);
  const handleAnalyze = useCallback((id: string) => analyzeMutate(id), [analyzeMutate]);
  const toggleExpand = useCallback((id: string) => {
    setExpandedAnalysis((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const columns = useMemo<ColumnDef<Capture, unknown>[]>(() => [
    {
      accessorKey: 'container_name',
      header: 'Container',
      cell: ({ row }) => {
        const capture = row.original;
        const analysis = parseAnalysis(capture);
        const isExpanded = expandedAnalysis.has(capture.id);
        return (
          <div className="flex items-center gap-2">
            {analysis && (
              <button
                onClick={() => toggleExpand(capture.id)}
                className="-ml-1 rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                title="Toggle analysis"
              >
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <div>
              <p className="font-medium">{capture.container_name}</p>
              <p className="text-xs text-muted-foreground">{capture.id.slice(0, 8)}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'endpoint_id',
      header: 'Endpoint',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {endpointNameById.get(row.original.endpoint_id) ?? `#${row.original.endpoint_id}`}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const capture = row.original;
        const analysis = parseAnalysis(capture);
        return (
          <div className="flex items-center gap-2">
            <StatusBadge status={capture.status} />
            {analysis && <HealthBadge status={analysis.health_status} />}
          </div>
        );
      },
    },
    {
      accessorKey: 'filter',
      header: 'Filter',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.filter || <span className="italic">none</span>}
        </span>
      ),
    },
    {
      accessorKey: 'file_size_bytes',
      header: 'File Size',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.file_size_bytes ? formatBytes(row.original.file_size_bytes) : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{new Date(row.original.created_at).toLocaleString()}</span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="block text-right">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const capture = row.original;
        const group = captureStatusGroup(capture.status);
        const isActive = group === 'running';
        const hasFile = Boolean(capture.capture_file) && group === 'finished';
        const canAnalyze = hasFile && !isActive;
        const isAnalyzing = analyzePending && analyzeVariables === capture.id;
        return (
          <div className="flex items-center justify-end gap-1">
            {isActive && (
              <button
                onClick={() => handleStop(capture.id)}
                disabled={!canCapture}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
                title={canCapture ? 'Stop capture' : NOT_ADMIN_REASON}
              >
                <Square className="h-4 w-4" />
              </button>
            )}
            {canAnalyze && (
              <button
                onClick={() => handleAnalyze(capture.id)}
                disabled={isAnalyzing || !canCapture}
                className="rounded p-1.5 text-muted-foreground hover:bg-purple-500/10 hover:text-purple-500 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                title={canCapture ? 'Analyze with AI' : NOT_ADMIN_REASON}
              >
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              </button>
            )}
            {hasFile && (
              <button
                onClick={() => handleDownload(capture.id)}
                className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                title="Download PCAP"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            {!isActive && (
              <button
                onClick={() => handleDelete(capture.id)}
                disabled={!canCapture}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
                title={canCapture ? 'Delete capture' : NOT_ADMIN_REASON}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ], [endpointNameById, expandedAnalysis, toggleExpand, handleStop, handleDelete, handleDownload, handleAnalyze, analyzePending, analyzeVariables, canCapture]);

  const expandedCaptures = useMemo(
    () =>
      captures
        .filter((c) => expandedAnalysis.has(c.id))
        .map((c) => ({ capture: c, analysis: parseAnalysis(c) }))
        .filter((entry): entry is { capture: Capture; analysis: PcapAnalysisResult } => entry.analysis !== null),
    [captures, expandedAnalysis],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={PAGE_TITLE}
        subtitle="tcpdump runs inside the target container; PCAPs download for Wireshark"
        actions={<RefreshButton onClick={() => refetch()} isLoading={isFetching} />}
      />

      {/* New Capture Form */}
      <SpotlightCard>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">New Capture</h2>

        {/* Target container */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium">Target container</label>
          <CaptureTargetPicker
            containers={runningContainers}
            stacks={stacks ?? []}
            edgeAsyncEndpointIds={edgeAsyncEndpointIds}
            value={target}
            onChange={setTarget}
          />
          {targetIsEdgeAsync && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              This container&apos;s endpoint is Edge Async — packet capture requires docker exec and is unavailable.
            </p>
          )}
          <CaptureBrowseFallback
            containers={runningContainers}
            stacks={stacks ?? []}
            endpoints={endpoints ?? []}
            edgeAsyncEndpointIds={edgeAsyncEndpointIds}
            onChange={setTarget}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* BPF Filter */}
          <BpfFilterInput value={bpfFilter} onChange={setBpfFilter} />

          {/* Duration */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              <Clock className="mr-1 inline h-3.5 w-3.5" />
              Duration (seconds)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              min={1}
              max={3600}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Max Packets */}
          <div>
            <label className="mb-1 block text-sm font-medium">Max Packets</label>
            <input
              type="number"
              value={maxPackets}
              onChange={(e) => setMaxPackets(e.target.value)}
              placeholder="Unlimited"
              min={1}
              max={100000}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Start Button */}
          <div className="flex flex-col justify-end">
            <button
              onClick={handleStartCapture}
              disabled={startDisabledReason !== null || startCapture.isPending}
              title={startDisabledReason ?? undefined}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                // A saturated primary at `opacity-50` reads as a soft-primary
                // button, indistinguishable from an enabled one. A disabled
                // control has to sit on a muted surface.
                startDisabledReason !== null || startCapture.isPending
                  ? 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              <Play className="h-4 w-4" />
              {startCapture.isPending ? 'Starting...' : 'Start Capture'}
            </button>
            {startDisabledReason && (
              <p className="mt-1 text-xs text-muted-foreground">{startDisabledReason}</p>
            )}
          </div>
        </div>
      </div>
      </SpotlightCard>

      {/* Active Captures */}
      {activeCaptures.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Active Captures</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {activeCaptures.map((capture) => (
              <ActiveCaptureCard
                key={capture.id}
                capture={capture}
                onStop={() => stopCapture.mutate(capture.id)}
                isStopping={stopCapture.isPending}
                canStop={canCapture}
              />
            ))}
          </div>
        </div>
      )}

      {/* History Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Capture History</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search history…"
              aria-label="Search capture history"
              className="rounded-md border bg-background px-3 py-1.5 text-xs"
            />
            <div className="flex gap-1 rounded-md border p-0.5">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.label}
                  onClick={() => setStatusFilter(tab.value)}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors',
                    statusFilter === tab.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {captures.length === 0 ? (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            {/*
              The stock version read "No captures found" / "Start a new capture
              above to begin monitoring network traffic" — search-result framing
              for a first-run state where nothing was searched, and a second line
              restating the form directly above it. What an operator needs before
              their first capture is how it runs and where the file goes.
            */}
            {hasAnyCaptures ? (
              <div className="text-center text-muted-foreground">
                <Radio className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="font-medium text-foreground">
                  No {STATUS_TABS.find((t) => t.value === statusFilter)?.label.toLowerCase()}{' '}
                  captures
                </p>
                <p className="text-sm">
                  {allCaptures.length} capture{allCaptures.length !== 1 ? 's' : ''} in history.
                  Switch to All to see {allCaptures.length !== 1 ? 'them' : 'it'}.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-xl">
                <div className="flex items-start gap-3">
                  <Radio className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium">No captures yet</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                      <li>
                        tcpdump runs <span className="text-foreground">inside</span> the target
                        container via docker exec — it sees only that container&apos;s
                        interfaces, and the container must be running.
                      </li>
                      <li>
                        A capture stops at whichever comes first: the duration, the packet
                        cap, or Stop.
                      </li>
                      <li>
                        The PCAP is written to the dashboard&apos;s pcap volume and stays
                        downloadable from this table until you delete it.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
          </SpotlightCard>
        ) : (
          <>
            <SpotlightCard>
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <DataTable columns={columns} data={captures} hideSearch minTableWidth={720} />
            </div>
            </SpotlightCard>

            {expandedCaptures.length > 0 && (
              <div className="space-y-3">
                {expandedCaptures.map(({ capture, analysis }) => (
                  <div key={capture.id} className="space-y-1">
                    <p className="px-1 text-xs font-medium text-muted-foreground">
                      {capture.container_name} · {capture.id.slice(0, 8)}
                    </p>
                    <AnalysisPanel
                      analysis={analysis}
                      onReanalyze={() => handleAnalyze(capture.id)}
                      isAnalyzing={analyzePending && analyzeVariables === capture.id}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActiveCaptureCard({
  capture,
  onStop,
  isStopping,
  canStop,
}: {
  capture: Capture;
  onStop: () => void;
  isStopping: boolean;
  /** `POST /api/pcap/captures/:id/stop` is `requireRole('admin')`. */
  canStop: boolean;
}) {
  return (
    <SpotlightCard>
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{capture.container_name}</p>
          <p className="text-xs text-muted-foreground">
            {capture.filter ? `Filter: ${capture.filter}` : 'No filter'}
          </p>
        </div>
        <StatusBadge status={capture.status} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatElapsed(capture.started_at)}
          </span>
          {capture.duration_seconds && (
            <span>Max: {capture.duration_seconds}s</span>
          )}
        </div>
        <button
          onClick={onStop}
          disabled={isStopping || capture.status === 'processing' || !canStop}
          title={canStop ? undefined : NOT_ADMIN_REASON}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
            isStopping || capture.status === 'processing' || !canStop
              ? 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
              : 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
          )}
        >
          <Square className="h-3 w-3" />
          Stop
        </button>
      </div>
    </div>
    </SpotlightCard>
  );
}

function parseAnalysis(capture: Capture): PcapAnalysisResult | null {
  const raw: unknown = capture.analysis_result;
  if (!raw) return null;
  // `pcap_captures.analysis_result` is JSONB, and the pg driver already parses
  // that column into an object — so the value arriving here is normally NOT a
  // string, and calling JSON.parse on it threw for every stored analysis,
  // silently hiding the whole panel. Accept both shapes: the object the API
  // actually sends, and a string in case a caller stringifies it.
  if (typeof raw === 'object') return raw as PcapAnalysisResult;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as PcapAnalysisResult;
  } catch {
    return null;
  }
}

function HealthBadge({ status }: { status: 'healthy' | 'degraded' | 'critical' }) {
  const styles = {
    healthy: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    degraded: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    critical: 'bg-red-500/10 text-red-600 dark:text-red-400',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', styles[status])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', {
        'bg-emerald-500': status === 'healthy',
        'bg-yellow-500': status === 'degraded',
        'bg-red-500': status === 'critical',
      })} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

const FINDING_ICONS = {
  anomaly: AlertTriangle,
  security: ShieldAlert,
  performance: Gauge,
  informational: Info,
} as const;

const SEVERITY_STYLES = {
  critical: 'border-red-500/30 bg-red-500/5',
  warning: 'border-yellow-500/30 bg-yellow-500/5',
  info: 'border-blue-500/30 bg-blue-500/5',
} as const;

function FindingCard({ finding }: { finding: PcapFinding }) {
  const Icon = FINDING_ICONS[finding.category];
  return (
    <div className={cn('rounded-lg border p-3', SEVERITY_STYLES[finding.severity])}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{finding.title}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase', {
              'bg-red-500/20 text-red-600': finding.severity === 'critical',
              'bg-yellow-500/20 text-yellow-600': finding.severity === 'warning',
              'bg-blue-500/20 text-blue-600': finding.severity === 'info',
            })}>
              {finding.severity}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{finding.description}</p>
          {finding.evidence && (
            <p className="mt-1 text-xs text-muted-foreground/80 italic">Evidence: {finding.evidence}</p>
          )}
          {finding.recommendation && (
            <p className="mt-2 text-xs font-medium">Recommendation: {finding.recommendation}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis, onReanalyze, isAnalyzing }: { analysis: PcapAnalysisResult; onReanalyze: () => void; isAnalyzing: boolean }) {
  return (
    <SpotlightCard>
    <div className="space-y-3 rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HealthBadge status={analysis.health_status} />
          {/*
            Omitted entirely when the model supplied no score, matching the
            remediation panel. Rendering it unguarded is worse than the default
            it replaced: `null * 100` is 0, so the badge would read a confident
            "Confidence: 0%" precisely where nothing was measured.
          */}
          {analysis.confidence_score !== null && (
            <span className="text-xs text-muted-foreground">
              Confidence: {Math.round(analysis.confidence_score * 100)}%
            </span>
          )}
        </div>
        <button
          onClick={onReanalyze}
          disabled={isAnalyzing}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
        >
          {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
          Re-analyze
        </button>
      </div>

      <p className="text-sm text-foreground">{analysis.summary}</p>

      {analysis.findings.length > 0 && (
        <div className="space-y-2">
          {analysis.findings.map((finding, i) => (
            <FindingCard key={i} finding={finding} />
          ))}
        </div>
      )}
    </div>
    </SpotlightCard>
  );
}
