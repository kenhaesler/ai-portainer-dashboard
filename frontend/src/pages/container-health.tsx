import { useState, useMemo } from 'react';
import { AlertTriangle, Activity, Clock, RotateCw, Box, Server, HardDrive } from 'lucide-react';
import { useContainers, type Container } from '@/hooks/use-containers';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatDate } from '@/lib/utils';
import { ContainerMetricsViewer } from '@/components/container/container-metrics-viewer';

function formatUptime(createdTimestamp: number): string {
  const now = Date.now();
  const created = createdTimestamp * 1000;
  const diff = now - created;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getHealthStatus(container: Container): string {
  if (container.healthStatus) {
    return container.healthStatus;
  }
  if (container.state === 'running') {
    return 'healthy';
  }
  return 'unknown';
}

function MetadataItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export default function ContainerHealthPage() {
  const [selectedContainerId, setSelectedContainerId] = useState<string | undefined>(undefined);

  const { data: containers, isLoading, isError, error, refetch, isFetching } = useContainers();
  const { interval, setInterval } = useAutoRefresh(30);

  // Filter to only running containers
  const runningContainers = useMemo(() =>
    containers?.filter((c) => c.state === 'running') ?? [],
    [containers]
  );

  // Get selected container
  const selectedContainer = useMemo(() =>
    runningContainers.find((c) => c.id === selectedContainerId),
    [runningContainers, selectedContainerId]
  );

  // Auto-select first container if none selected
  useMemo(() => {
    if (!selectedContainerId && runningContainers.length > 0) {
      setSelectedContainerId(runningContainers[0].id);
    }
  }, [selectedContainerId, runningContainers]);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Health</h1>
          <p className="text-muted-foreground">
            Health status deep-dive with metrics
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load containers</p>
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
          <h1 className="text-3xl font-bold tracking-tight">Container Health</h1>
          <p className="text-muted-foreground">
            Health status deep-dive with metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Container Selector */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="container-select" className="text-sm font-medium">
            Container
          </label>
          <select
            id="container-select"
            value={selectedContainerId ?? ''}
            onChange={(e) => setSelectedContainerId(e.target.value || undefined)}
            className="min-w-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select a container</option>
            {runningContainers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.endpointName})
              </option>
            ))}
          </select>
        </div>

        <span className="ml-4 text-sm text-muted-foreground">
          {runningContainers.length} running container{runningContainers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          <SkeletonCard className="h-[400px]" />
          <SkeletonCard className="h-[400px]" />
        </div>
      ) : !selectedContainer ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <Activity className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-4">
            {runningContainers.length === 0
              ? 'No running containers found'
              : 'Select a container to view health metrics'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Health Status and Metadata Card */}
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                  <Box className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">{selectedContainer.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedContainer.id.slice(0, 12)}
                  </p>
                </div>
              </div>
              <StatusBadge
                status={getHealthStatus(selectedContainer)}
                className="text-sm px-3 py-1"
              />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <MetadataItem
                icon={Server}
                label="Endpoint"
                value={selectedContainer.endpointName}
              />
              <MetadataItem
                icon={HardDrive}
                label="Image"
                value={selectedContainer.image.split(':')[0].split('/').pop() || selectedContainer.image}
              />
              <MetadataItem
                icon={Clock}
                label="Uptime"
                value={formatUptime(selectedContainer.created)}
              />
              <MetadataItem
                icon={Activity}
                label="Status"
                value={selectedContainer.status}
              />
              <MetadataItem
                icon={RotateCw}
                label="Created"
                value={formatDate(new Date(selectedContainer.created * 1000))}
              />
            </div>
          </div>

          {/* Metrics Charts */}
          <ContainerMetricsViewer
            endpointId={selectedContainer.endpointId}
            containerId={selectedContainer.id}
          />
        </div>
      )}
    </div>
  );
}
