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
  downloadCapture,
  type Capture,
} from '@/hooks/use-pcap';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ThemedSelect } from '@/components/shared/themed-select';
import { buildStackGroupedContainerOptions } from '@/lib/container-stack-grouping';

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
  { label: 'Stopped', value: 'stopped' },
  { label: 'Failed', value: 'failed' },
] as const;

export default function PacketCapture() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>();
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
  const startCapture = useStartCapture();
  const stopCapture = useStopCapture();
  const deleteCapture = useDeleteCapture();

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
  const groupedContainerOptions = useMemo(
    () => buildStackGroupedContainerOptions(runningContainers, stackNamesForEndpoint),
    [runningContainers, stackNamesForEndpoint],
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
    const container = runningContainers.find((c) => c.id === value);
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

function CaptureRow({
  capture,
  onStop,
  onDelete,
  onDownload,
}: {
  capture: Capture;
  onStop: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const isActive = capture.status === 'capturing' || capture.status === 'pending' || capture.status === 'processing';
  const hasFile = capture.capture_file && (capture.status === 'complete' || capture.status === 'stopped');

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2">
        <div>
          <p className="font-medium">{capture.container_name}</p>
          <p className="text-xs text-muted-foreground">{capture.id.slice(0, 8)}</p>
        </div>
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={capture.status} />
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
  );
}
