import { useMemo, useState } from 'react';
import {
  Radio,
  RefreshCw,
  Play,
  Square,
  Download,
  Trash2,
  Clock,
  Filter,
  Brain,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ShieldAlert,
  Gauge,
  Info,
  Loader2,
} from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { useStacks } from '@/hooks/use-stacks';
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
} from '@/hooks/use-pcap';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ThemedSelect } from '@/components/shared/themed-select';
import { buildStackGroupedContainerOptions, NO_STACK_LABEL, resolveContainerStackName } from '@/lib/container-stack-grouping';

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
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>();
  const [selectedStack, setSelectedStack] = useState<string | undefined>();
  const [selectedContainer, setSelectedContainer] = useState('');
  const [selectedContainerName, setSelectedContainerName] = useState('');
  const [bpfFilter, setBpfFilter] = useState('');
  const [duration, setDuration] = useState('60');
  const [maxPackets, setMaxPackets] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const { data: endpoints } = useEndpoints();
  const { data: containers } = useContainers(selectedEndpoint);
  const { data: stacks } = useStacks();
  const { data: capturesData, refetch } = useCaptures({ status: statusFilter });
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<string>>(new Set());
  const startCapture = useStartCapture();
  const stopCapture = useStopCapture();
  const deleteCapture = useDeleteCapture();
  const analyzeMutation = useAnalyzeCapture();

  const captures = capturesData?.captures ?? [];
  const activeCaptures = captures.filter(
    (c) => c.status === 'capturing' || c.status === 'pending' || c.status === 'processing',
  );
  const runningContainers = containers?.filter((c) => c.state === 'running') ?? [];
  const stackNamesForEndpoint = useMemo(() => {
    if (!selectedEndpoint || !stacks) return [];
    return stacks
      .filter((stack) => stack.endpointId === selectedEndpoint)
      .map((stack) => stack.name);
  }, [selectedEndpoint, stacks]);
  const stackOptions = useMemo(() => {
    const stackSet = new Set<string>(stackNamesForEndpoint);
    for (const container of runningContainers) {
      const resolvedStack = resolveContainerStackName(container, stackNamesForEndpoint) ?? NO_STACK_LABEL;
      stackSet.add(resolvedStack);
    }
    return [...stackSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  }, [runningContainers, stackNamesForEndpoint]);
  const filteredRunningContainers = useMemo(() => {
    if (!selectedStack) return runningContainers;
    return runningContainers.filter((container) => {
      const resolvedStack = resolveContainerStackName(container, stackNamesForEndpoint) ?? NO_STACK_LABEL;
      return resolvedStack === selectedStack;
    });
  }, [runningContainers, selectedStack, stackNamesForEndpoint]);
  const groupedContainerOptions = useMemo(
    () => buildStackGroupedContainerOptions(filteredRunningContainers, stackNamesForEndpoint),
    [filteredRunningContainers, stackNamesForEndpoint],
  );

  const handleStartCapture = () => {
    if (!selectedEndpoint || !selectedContainer) return;

    startCapture.mutate({
      endpointId: selectedEndpoint,
      containerId: selectedContainer,
      containerName: selectedContainerName,
      filter: bpfFilter || undefined,
      durationSeconds: duration ? parseInt(duration, 10) : undefined,
      maxPackets: maxPackets ? parseInt(maxPackets, 10) : undefined,
    });
  };

  const handleContainerChange = (value: string) => {
    setSelectedContainer(value);
    const container = filteredRunningContainers.find((c) => c.id === value);
    setSelectedContainerName(container?.name ?? '');
  };

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
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* New Capture Form */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">New Capture</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Endpoint */}
          <div>
            <label className="mb-1 block text-sm font-medium">Endpoint</label>
            <ThemedSelect
              value={selectedEndpoint != null ? String(selectedEndpoint) : '__all__'}
              onValueChange={(val) => {
                const resolved = val === '__all__' ? undefined : Number(val);
                setSelectedEndpoint(resolved);
                setSelectedStack(undefined);
                setSelectedContainer('');
                setSelectedContainerName('');
              }}
              placeholder="Select endpoint..."
              options={[
                { value: '__all__', label: 'Select endpoint...' },
                ...(endpoints?.map((ep) => ({ value: String(ep.id), label: ep.name })) ?? []),
              ]}
              className="w-full text-sm"
            />
          </div>

          {/* Stack */}
          <div>
            <label className="mb-1 block text-sm font-medium">Stack</label>
            <ThemedSelect
              value={selectedStack ?? '__all__'}
              onValueChange={(val) => {
                setSelectedStack(val === '__all__' ? undefined : val);
                setSelectedContainer('');
                setSelectedContainerName('');
              }}
              disabled={!selectedEndpoint}
              placeholder="All stacks"
              options={[
                { value: '__all__', label: 'All stacks' },
                ...stackOptions.map((stackName) => ({ value: stackName, label: stackName })),
              ]}
              className="w-full text-sm"
            />
          </div>

          {/* Container */}
          <div>
            <label className="mb-1 block text-sm font-medium">Container</label>
            <ThemedSelect
              value={selectedContainer || '__all__'}
              onValueChange={(val) => handleContainerChange(val === '__all__' ? '' : val)}
              disabled={!selectedEndpoint}
              placeholder="Select container..."
              options={[
                { value: '__all__', label: 'Select container...' },
                ...groupedContainerOptions,
              ]}
              className="w-full text-sm"
            />
          </div>

          {/* BPF Filter */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              <Filter className="mr-1 inline h-3.5 w-3.5" />
              BPF Filter
            </label>
            <input
              type="text"
              value={bpfFilter}
              onChange={(e) => setBpfFilter(e.target.value)}
              placeholder="e.g. port 80 or tcp"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

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
              disabled={!selectedEndpoint || !selectedContainer || startCapture.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {startCapture.isPending ? 'Starting...' : 'Start Capture'}
            </button>
          </div>
        </div>
      </div>

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

        {captures.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            <Radio className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p className="font-medium">No captures found</p>
            <p className="text-sm">Start a new capture above to begin monitoring network traffic.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Container</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Filter</th>
                  <th className="px-4 py-2 text-left font-medium">File Size</th>
                  <th className="px-4 py-2 text-left font-medium">Created</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {captures.map((capture) => (
                  <CaptureRow
                    key={capture.id}
                    capture={capture}
                    onStop={() => stopCapture.mutate(capture.id)}
                    onDelete={() => deleteCapture.mutate(capture.id)}
                    onDownload={() => downloadCapture(capture.id, api.getToken())}
                    onAnalyze={() => analyzeMutation.mutate(capture.id)}
                    isAnalyzing={analyzeMutation.isPending && analyzeMutation.variables === capture.id}
                    isExpanded={expandedAnalysis.has(capture.id)}
                    onToggleExpand={() => {
                      setExpandedAnalysis((prev) => {
                        const next = new Set(prev);
                        if (next.has(capture.id)) next.delete(capture.id);
                        else next.add(capture.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
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
    <div className="rounded-lg border bg-card p-4">
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
    <div className="space-y-3 rounded-lg border bg-card/50 p-4">
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
  );
}

function CaptureRow({
  capture,
  onStop,
  onDelete,
  onDownload,
  onAnalyze,
  isAnalyzing,
  isExpanded,
  onToggleExpand,
}: {
  capture: Capture;
  onStop: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const isActive = capture.status === 'capturing' || capture.status === 'pending' || capture.status === 'processing';
  const hasFile = capture.capture_file && (capture.status === 'complete' || capture.status === 'succeeded');
  const analysis = parseAnalysis(capture);
  const canAnalyze = hasFile && !isActive;

  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            {analysis && (
              <button onClick={onToggleExpand} className="text-muted-foreground hover:text-foreground" title="Toggle analysis">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            )}
            <div>
              <p className="font-medium">{capture.container_name}</p>
              <p className="text-xs text-muted-foreground">{capture.id.slice(0, 8)}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={capture.status} />
            {analysis && <HealthBadge status={analysis.health_status} />}
          </div>
        </td>
        <td className="px-4 py-2 text-muted-foreground">
          {capture.filter || <span className="italic">none</span>}
        </td>
        <td className="px-4 py-2 text-muted-foreground">
          {capture.file_size_bytes ? formatBytes(capture.file_size_bytes) : '-'}
        </td>
        <td className="px-4 py-2 text-muted-foreground">
          {new Date(capture.created_at).toLocaleString()}
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            {isActive && (
              <button
                onClick={onStop}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Stop capture"
              >
                <Square className="h-4 w-4" />
              </button>
            )}
            {canAnalyze && (
              <button
                onClick={onAnalyze}
                disabled={isAnalyzing}
                className="rounded p-1.5 text-muted-foreground hover:bg-purple-500/10 hover:text-purple-500"
                title="Analyze with AI"
              >
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              </button>
            )}
            {hasFile && (
              <button
                onClick={onDownload}
                className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                title="Download PCAP"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            {!isActive && (
              <button
                onClick={onDelete}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Delete capture"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {analysis && isExpanded && (
        <tr>
          <td colSpan={6} className="px-4 py-3">
            <AnalysisPanel analysis={analysis} onReanalyze={onAnalyze} isAnalyzing={isAnalyzing} />
          </td>
        </tr>
      )}
    </>
  );
}
