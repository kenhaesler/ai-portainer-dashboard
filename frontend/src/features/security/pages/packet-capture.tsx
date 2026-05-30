import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
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
import { DataTable } from '@/shared/components/tables/data-table';
import { RefreshButton } from '@/shared/components/ui/refresh-button';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useContainers } from '@/features/containers/hooks/use-containers';
import { useStacks } from '@/features/containers/hooks/use-stacks';
import {
  useCaptures,
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
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

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

const STATUS_TABS = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'capturing' },
  { label: 'Complete', value: 'complete' },
  { label: 'Succeeded', value: 'succeeded' },
  { label: 'Failed', value: 'failed' },
] as const;

export default function PacketCapture() {
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const [bpfFilter, setBpfFilter] = useState('');
  const [duration, setDuration] = useState('60');
  const [maxPackets, setMaxPackets] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [historySearch, setHistorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(historySearch), 300);
    return () => clearTimeout(t);
  }, [historySearch]);

  const { data: endpoints } = useEndpoints();
  const { data: containers } = useContainers({ state: 'running' });
  const { data: stacks } = useStacks();
  const { data: capturesData, refetch, isFetching } = useCaptures({
    status: statusFilter,
    search: debouncedSearch || undefined,
  });
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<string>>(new Set());
  const startCapture = useStartCapture();
  const stopCapture = useStopCapture();
  const deleteCapture = useDeleteCapture();
  const analyzeMutation = useAnalyzeCapture();

  const captures = capturesData?.captures ?? [];
  const activeCaptures = captures.filter(
    (c) => c.status === 'capturing' || c.status === 'pending' || c.status === 'processing',
  );
  const edgeAsyncEndpointIds = useMemo(
    () => new Set((endpoints ?? []).filter((e) => e.edgeMode === 'async').map((e) => e.id)),
    [endpoints],
  );
  const endpointNameById = useMemo(
    () => new Map((endpoints ?? []).map((e) => [e.id, e.name])),
    [endpoints],
  );
  const runningContainers = useMemo(
    () => (containers ?? []).filter((c) => c.state === 'running'),
    [containers],
  );
  const targetIsEdgeAsync = target ? edgeAsyncEndpointIds.has(target.endpointId) : false;

  const handleStartCapture = () => {
    if (!target || targetIsEdgeAsync) return;

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
  const handleDownload = useCallback((id: string) => downloadCapture(id, api.getToken()), []);
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
        const isActive = capture.status === 'capturing' || capture.status === 'pending' || capture.status === 'processing';
        const hasFile = capture.capture_file && (capture.status === 'complete' || capture.status === 'succeeded');
        const canAnalyze = hasFile && !isActive;
        const isAnalyzing = analyzePending && analyzeVariables === capture.id;
        return (
          <div className="flex items-center justify-end gap-1">
            {isActive && (
              <button
                onClick={() => handleStop(capture.id)}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Stop capture"
              >
                <Square className="h-4 w-4" />
              </button>
            )}
            {canAnalyze && (
              <button
                onClick={() => handleAnalyze(capture.id)}
                disabled={isAnalyzing}
                className="rounded p-1.5 text-muted-foreground hover:bg-purple-500/10 hover:text-purple-500"
                title="Analyze with AI"
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
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Delete capture"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ], [endpointNameById, expandedAnalysis, toggleExpand, handleStop, handleDelete, handleDownload, handleAnalyze, analyzePending, analyzeVariables]);

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Radio className="h-6 w-6" />
            Packet Capture
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture network traffic from containers using tcpdump. Download PCAP files for analysis in Wireshark.
          </p>
        </div>
        <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
      </div>

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
          <div className="flex items-end">
            <button
              onClick={handleStartCapture}
              disabled={!target || targetIsEdgeAsync || startCapture.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {startCapture.isPending ? 'Starting...' : 'Start Capture'}
            </button>
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
          <div className="rounded-lg border bg-card p-6 shadow-sm text-center text-muted-foreground">
            <Radio className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p className="font-medium">No captures found</p>
            <p className="text-sm">Start a new capture above to begin monitoring network traffic.</p>
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
}: {
  capture: Capture;
  onStop: () => void;
  isStopping: boolean;
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
          disabled={isStopping || capture.status === 'processing'}
          className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
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
  if (!capture.analysis_result) return null;
  try {
    return JSON.parse(capture.analysis_result) as PcapAnalysisResult;
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
          <span className="text-xs text-muted-foreground">
            Confidence: {Math.round(analysis.confidence_score * 100)}%
          </span>
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
