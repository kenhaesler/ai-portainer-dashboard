import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useContainerDetail } from '@/hooks/use-container-detail';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { RefreshButton } from '@/components/shared/refresh-button';
import { ContainerActionsBar } from '@/components/container/container-actions-bar';
import { ContainerOverview } from '@/components/container/container-overview';
import { ContainerLogsViewer } from '@/components/container/container-logs-viewer';
import { ContainerMetricsViewer } from '@/components/container/container-metrics-viewer';

export default function ContainerDetailPage() {
  const navigate = useNavigate();
  const { endpointId, containerId } = useParams<{ endpointId: string; containerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse URL params
  const parsedEndpointId = endpointId ? Number(endpointId) : undefined;
  const defaultTab = searchParams.get('tab') || 'overview';

  // Fetch container details
  const {
    data: container,
    isLoading,
    isError,
    error,
    refetch,
    isFetching
  } = useContainerDetail(parsedEndpointId!, containerId!);

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
            <h1 className="text-3xl font-bold tracking-tight">{container.name}</h1>
            <p className="text-muted-foreground">
              {container.id.slice(0, 12)} • {container.endpointName}
            </p>
          </div>
        </div>
        <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
      </div>

      {/* Actions Bar */}
      <ContainerActionsBar container={container} onActionComplete={() => refetch()} />

      {/* Tabs */}
      <Tabs.Root
        value={defaultTab}
        onValueChange={handleTabChange}
        className="space-y-6"
      >
        <Tabs.List className="flex items-center gap-1 border-b">
          <Tabs.Trigger
            value="overview"
            className="px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger
            value="logs"
            className="px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            Logs
          </Tabs.Trigger>
          <Tabs.Trigger
            value="metrics"
            className="px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
          >
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
          />
        </Tabs.Content>

        <Tabs.Content value="metrics" className="focus:outline-none">
          {container.state === 'running' ? (
            <ContainerMetricsViewer
              endpointId={container.endpointId}
              containerId={container.id}
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
