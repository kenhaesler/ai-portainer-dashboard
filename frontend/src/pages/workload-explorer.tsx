import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Play, Square, RotateCw, AlertTriangle } from 'lucide-react';
import { useContainers, useContainerAction, type Container } from '@/hooks/use-containers';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatDate, truncate } from '@/lib/utils';

type ContainerAction = 'start' | 'stop' | 'restart';

interface PendingAction {
  container: Container;
  action: ContainerAction;
}

const ACTION_CONFIG: Record<ContainerAction, { label: string; variant: 'default' | 'destructive'; description: (name: string) => string }> = {
  start: {
    label: 'Start',
    variant: 'default',
    description: (name) => `Are you sure you want to start container "${name}"?`,
  },
  stop: {
    label: 'Stop',
    variant: 'destructive',
    description: (name) => `Are you sure you want to stop container "${name}"? Running processes will be terminated.`,
  },
  restart: {
    label: 'Restart',
    variant: 'default',
    description: (name) => `Are you sure you want to restart container "${name}"?`,
  },
};

export default function WorkloadExplorerPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const { data: endpoints } = useEndpoints();
  const { data: containers, isLoading, isError, error, refetch, isFetching } = useContainers(selectedEndpoint);
  const containerAction = useContainerAction();
  const { interval, setInterval } = useAutoRefresh(30);

  const handleAction = (container: Container, action: ContainerAction) => {
    setPendingAction({ container, action });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    await containerAction.mutateAsync({
      endpointId: pendingAction.container.endpointId,
      containerId: pendingAction.container.id,
      action: pendingAction.action,
    });
  };

  const columns: ColumnDef<Container, any>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ getValue }) => (
        <span className="font-medium">{truncate(getValue<string>(), 40)}</span>
      ),
    },
    {
      accessorKey: 'image',
      header: 'Image',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{truncate(getValue<string>(), 50)}</span>
      ),
    },
    {
      accessorKey: 'state',
      header: 'State',
      cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'endpointName',
      header: 'Endpoint',
      cell: ({ row }) => {
        const container = row.original;
        return `${container.endpointName} (ID: ${container.endpointId})`;
      },
    },
    {
      accessorKey: 'created',
      header: 'Created',
      cell: ({ getValue }) => formatDate(new Date(getValue<number>() * 1000)),
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const container = row.original;
        const isRunning = container.state === 'running';
        return (
          <div className="flex items-center gap-1">
            {isRunning ? (
              <>
                <button
                  onClick={() => handleAction(container, 'stop')}
                  title="Stop"
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                >
                  <Square className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleAction(container, 'restart')}
                  title="Restart"
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => handleAction(container, 'start')}
                title="Start"
                className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400"
              >
                <Play className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ], []);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workload Explorer</h1>
          <p className="text-muted-foreground">
            Browse and manage containers across all endpoints
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
          <h1 className="text-3xl font-bold tracking-tight">Workload Explorer</h1>
          <p className="text-muted-foreground">
            Browse and manage containers across all endpoints
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Endpoint Selector */}
      <div className="flex items-center gap-4">
        <label htmlFor="endpoint-select" className="text-sm font-medium">
          Endpoint
        </label>
        <select
          id="endpoint-select"
          value={selectedEndpoint ?? ''}
          onChange={(e) => setSelectedEndpoint(e.target.value ? Number(e.target.value) : undefined)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All endpoints</option>
          {endpoints?.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.name} (ID: {ep.id})
            </option>
          ))}
        </select>
        {containers && (
          <span className="text-sm text-muted-foreground">
            {containers.length} container{containers.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Container Table */}
      {isLoading ? (
        <SkeletonCard className="h-[500px]" />
      ) : containers ? (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <DataTable
            columns={columns}
            data={containers}
            searchKey="name"
            searchPlaceholder="Search containers by name..."
            pageSize={15}
          />
        </div>
      ) : null}

      {/* Confirm Dialog */}
      {pendingAction && (
        <ConfirmDialog
          open={!!pendingAction}
          onOpenChange={(open) => { if (!open) setPendingAction(null); }}
          title={`${ACTION_CONFIG[pendingAction.action].label} Container`}
          description={ACTION_CONFIG[pendingAction.action].description(pendingAction.container.name)}
          confirmLabel={ACTION_CONFIG[pendingAction.action].label}
          variant={ACTION_CONFIG[pendingAction.action].variant}
          onConfirm={confirmAction}
        />
      )}
    </div>
  );
}
