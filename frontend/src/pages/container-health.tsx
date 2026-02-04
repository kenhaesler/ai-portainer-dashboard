import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Activity, Clock, Box, Server, ChevronRight } from 'lucide-react';
import { useContainers, type Container } from '@/hooks/use-containers';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatDate } from '@/lib/utils';

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

interface ContainerCardProps {
  container: Container;
  onClick: () => void;
}

function ContainerCard({ container, onClick }: ContainerCardProps) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full rounded-lg border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/50 text-left"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            <Box className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate group-hover:text-primary transition-colors">
              {container.name}
            </h3>
            <p className="text-sm text-muted-foreground font-mono truncate">
              {container.id.slice(0, 12)}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </div>

      {/* Status Badge */}
      <div className="mb-4">
        <StatusBadge status={getHealthStatus(container)} className="text-xs px-2 py-1" />
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Endpoint</p>
          <p className="font-medium truncate">{container.endpointName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Uptime</p>
          <p className="font-medium">{formatUptime(container.created)}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground mb-1">Image</p>
          <p className="font-medium truncate">{container.image}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground mb-1">Status</p>
          <p className="text-xs">{container.status}</p>
        </div>
      </div>

      {/* View Details Hint */}
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
          Click to view details, logs, and metrics →
        </p>
      </div>
    </button>
  );
}

export default function ContainerHealthPage() {
  const navigate = useNavigate();
  const { data: containers, isLoading, isError, error, refetch, isFetching } = useContainers();
  const { interval, setInterval } = useAutoRefresh(30);

  // Filter to only running containers
  const runningContainers = useMemo(() =>
    containers?.filter((c) => c.state === 'running') ?? [],
    [containers]
  );

  const handleContainerClick = (container: Container) => {
    navigate(`/containers/${container.endpointId}/${container.id}?tab=metrics`);
  };

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Running Containers</h1>
          <p className="text-muted-foreground">
            Monitor health and metrics for running containers
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
          <h1 className="text-3xl font-bold tracking-tight">Running Containers</h1>
          <p className="text-muted-foreground">
            Monitor health and metrics for running containers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4">
        <div className="rounded-lg border bg-card px-4 py-2">
          <p className="text-2xl font-bold">{runningContainers.length}</p>
          <p className="text-xs text-muted-foreground">Running Containers</p>
        </div>
        {containers && (
          <div className="rounded-lg border bg-card px-4 py-2">
            <p className="text-2xl font-bold">{containers.length}</p>
            <p className="text-xs text-muted-foreground">Total Containers</p>
          </div>
        )}
      </div>

      {/* Container Grid */}
      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard className="h-[280px]" />
          <SkeletonCard className="h-[280px]" />
          <SkeletonCard className="h-[280px]" />
          <SkeletonCard className="h-[280px]" />
          <SkeletonCard className="h-[280px]" />
          <SkeletonCard className="h-[280px]" />
        </div>
      ) : runningContainers.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Activity className="mx-auto h-16 w-16 text-muted-foreground opacity-50" />
          <p className="mt-4 text-lg font-medium">No running containers found</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Start some containers to see their health metrics here
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {runningContainers.map((container) => (
            <ContainerCard
              key={container.id}
              container={container}
              onClick={() => handleContainerClick(container)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
