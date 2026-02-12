import { useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Info, ScrollText, Activity, Clock, Wifi } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useContainerDetail } from '@/hooks/use-container-detail';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { FavoriteButton } from '@/components/shared/favorite-button';
import { ContainerOverview } from '@/components/container/container-overview';
import { ContainerLogsViewer } from '@/components/container/container-logs-viewer';
import { ContainerMetricsViewer } from '@/components/container/container-metrics-viewer';
import { useEndpoints, useEndpointCapabilities } from '@/hooks/use-endpoints';

const TIME_RANGES = [
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

export default function ContainerDetailPage() {
  const navigate = useNavigate();
  const { endpointId, containerId } = useParams<{ endpointId: string; containerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [metricsTimeRange, setMetricsTimeRange] = useState('1h');

  // Parse URL params
  const parsedEndpointId = endpointId ? Number(endpointId) : undefined;
  const activeTab = searchParams.get('tab') || 'overview';

  // Fetch container details
  const {
    data: container,
    isLoading,
    isError,
    error,
    refetch,
    isFetching
  } = useContainerDetail(parsedEndpointId!, containerId!);
  const { forceRefresh, isForceRefreshing } = useForceRefresh('containers', refetch);

  // Look up endpoint for Edge staleness banner
  const { data: endpoints } = useEndpoints();
  const currentEndpoint = endpoints?.find(ep => ep.id === parsedEndpointId);
  const isEdgeStale = currentEndpoint?.isEdge && currentEndpoint.snapshotAge != null && currentEndpoint.snapshotAge > 5 * 60 * 1000;
  const { isEdgeAsync, capabilities } = useEndpointCapabilities(parsedEndpointId);

  // Handle tab change
  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  // Error state - invalid params
  if (!parsedEndpointId || !containerId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Details</h1>
          <p className="text-muted-foreground">
            View detailed information about a container
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Invalid URL parameters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please provide valid endpoint ID and container ID
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Details</h1>
          <p className="text-muted-foreground">
            View detailed information about a container
          </p>
        </div>
        <SkeletonCard className="h-[600px]" />
      </div>
    );
  }

  // Error state - container not found
  if (isError || !container) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Details</h1>
          <p className="text-muted-foreground">
            View detailed information about a container
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Container not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'The requested container could not be found'}
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
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/workloads')}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background hover:bg-accent"
            title="Back to Workload Explorer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{container.name}</h1>
              <FavoriteButton endpointId={parsedEndpointId} containerId={containerId} />
            </div>
            <p className="text-muted-foreground">
              {container.id.slice(0, 12)} • {container.endpointName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" data-testid="metrics-header-controls">
          {activeTab === 'metrics' && container.state === 'running' && (
            <div className="flex items-center gap-2" data-testid="metrics-time-range-control">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div className="inline-flex h-10 items-center rounded-full border border-input bg-background p-1" data-testid="time-range-selector">
                {TIME_RANGES.map((range) => (
                  <button
                    key={range.value}
                    type="button"
                    onClick={() => setMetricsTimeRange(range.value)}
                    className={`inline-flex h-8 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors ${
                      metricsTimeRange === range.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <RefreshButton onClick={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {/* Edge Async capability warning */}
      {isEdgeAsync && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-3">
          <Wifi className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Edge Async Agent — Live features unavailable
            </p>
            <p className="text-xs text-muted-foreground">
              This endpoint uses asynchronous communication. Real-time logs and live metrics are not available. Overview data is from the last snapshot.
            </p>
          </div>
        </div>
      )}

      {/* Edge staleness warning (non-async Edge agents with stale data) */}
      {!isEdgeAsync && isEdgeStale && currentEndpoint && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-3">
          <Wifi className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Edge Agent — Data may be stale
            </p>
            <p className="text-xs text-muted-foreground">
              Last check-in: {currentEndpoint.lastCheckIn ? `${Math.round((Date.now() - currentEndpoint.lastCheckIn * 1000) / 1000)}s ago` : 'unknown'}.
              {' '}Snapshot age: {currentEndpoint.snapshotAge != null ? `${Math.round(currentEndpoint.snapshotAge / 1000)}s` : 'unknown'}.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={handleTabChange}
        className="space-y-6"
      >
        <Tabs.List className="flex items-center gap-1 border-b">
          <Tabs.Trigger
            value="overview"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <Info className="h-4 w-4" />
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger
            value="logs"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <ScrollText className="h-4 w-4" />
            Logs
          </Tabs.Trigger>
          <Tabs.Trigger
            value="metrics"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            <Activity className="h-4 w-4" />
            Metrics
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="focus:outline-none">
          <ContainerOverview container={container} />
        </Tabs.Content>

        <Tabs.Content value="logs" className="focus:outline-none">
          <ContainerLogsViewer
            endpointId={container.endpointId}
            containerId={container.id}
            isEdgeAsync={isEdgeAsync}
          />
        </Tabs.Content>

        <Tabs.Content value="metrics" className="focus:outline-none">
          {!capabilities.liveStats ? (
            <div className="rounded-lg border bg-card p-8 text-center">
              <Wifi className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-4 font-medium">Live metrics unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This Edge Async endpoint does not support live container stats
              </p>
            </div>
          ) : container.state === 'running' ? (
            <ContainerMetricsViewer
              endpointId={container.endpointId}
              containerId={container.id}
              containerNetworks={container.networks}
              timeRange={metricsTimeRange}
              onTimeRangeChange={setMetricsTimeRange}
              showTimeRangeSelector={false}
            />
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-4 font-medium">Container is not running</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Metrics are only available for running containers
              </p>
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
