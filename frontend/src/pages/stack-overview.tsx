import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Layers, LayoutGrid, List, AlertTriangle, Search } from 'lucide-react';
import { useStacks, type Stack } from '@/hooks/use-stacks';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

interface StackWithEndpoint extends Stack {
  endpointName: string;
}

function DiscoveredBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
      <Search className="h-3 w-3" />
      Discovered
    </span>
  );
}

function StackCard({ stack, onClick }: { stack: StackWithEndpoint; onClick: () => void }) {
  const isInferred = stack.source === 'compose-label';

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const getStackType = (type: number) => {
    switch (type) {
      case 1:
        return 'Swarm';
      case 2:
        return 'Compose';
      case 3:
        return 'Kubernetes';
      default:
        return `Type ${type}`;
    }
  };

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border bg-card p-6 shadow-sm text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'rounded-lg p-2',
            stack.status === 'active'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
          )}>
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">{stack.name}</h3>
            {isInferred ? <DiscoveredBadge /> : <p className="text-xs text-muted-foreground">ID: {stack.id}</p>}
          </div>
        </div>
        <StatusBadge status={stack.status} />
      </div>

      <div className="mt-4 space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Endpoint</p>
          <p className="mt-1 font-medium text-sm">
            {stack.endpointName}
            <span className="ml-2 text-xs text-muted-foreground">(ID: {stack.endpointId})</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="mt-1 text-sm font-medium">{getStackType(stack.type)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{isInferred ? 'Containers' : 'Env Vars'}</p>
            <p className="mt-1 text-sm font-medium">{isInferred ? stack.containerCount ?? 0 : stack.envCount}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="mt-1 text-sm">{formatDate(stack.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Updated</p>
            <p className="mt-1 text-sm">{formatDate(stack.updatedAt)}</p>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function StackOverviewPage() {
  const viewMode = useUiStore((s) => s.pageViewModes['stacks'] ?? 'grid');
  const setViewMode = useUiStore((s) => s.setPageViewMode);
  const navigate = useNavigate();

  const { data: stacks, isLoading: stacksLoading, isError, error, refetch, isFetching } = useStacks();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('stacks', refetch);
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();
  const { interval, setInterval } = useAutoRefresh(30);

  const isLoading = stacksLoading || endpointsLoading;

  const stacksWithEndpoints = useMemo<StackWithEndpoint[]>(() => {
    if (!stacks || !endpoints) return [];
    return stacks.map(stack => ({
      ...stack,
      endpointName: endpoints.find(ep => ep.id === stack.endpointId)?.name || `Endpoint ${stack.endpointId}`,
    }));
  }, [stacks, endpoints]);

  const handleStackClick = (stack: StackWithEndpoint) => {
    navigate(`/workloads?endpoint=${stack.endpointId}&stack=${encodeURIComponent(stack.name)}`);
  };

  const getStackType = (type: number) => {
    switch (type) {
      case 1:
        return 'Swarm';
      case 2:
        return 'Compose';
      case 3:
        return 'Kubernetes';
      default:
        return `Type ${type}`;
    }
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const columns: ColumnDef<StackWithEndpoint, unknown>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.source === 'compose-label'
            ? <DiscoveredBadge />
            : <span className="text-xs text-muted-foreground">(ID: {row.original.id})</span>
          }
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
    },
    {
      accessorKey: 'endpointName',
      header: 'Endpoint',
      cell: ({ row }) => (
        <div>
          <span>{row.original.endpointName}</span>
          <span className="ml-2 text-xs text-muted-foreground">(ID: {row.original.endpointId})</span>
        </div>
      ),
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ getValue }) => getStackType(getValue<number>()),
    },
    {
      id: 'envOrContainers',
      header: 'Details',
      cell: ({ row }) => row.original.source === 'compose-label'
        ? `${row.original.containerCount ?? 0} containers`
        : `${row.original.envCount} env vars`,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ getValue }) => formatDate(getValue<number>()),
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ getValue }) => formatDate(getValue<number>()),
    },
  ], []);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stack Overview</h1>
          <p className="text-muted-foreground">
            Monitor all Docker Stacks across your fleet
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load stacks</p>
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

  const activeCount = stacksWithEndpoints.filter(s => s.status === 'active').length;
  const inactiveCount = stacksWithEndpoints.filter(s => s.status === 'inactive').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stack Overview</h1>
          <p className="text-muted-foreground">
            Monitor all Docker Stacks across your fleet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {/* Summary and View Toggle */}
      {!isLoading && stacksWithEndpoints.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {stacksWithEndpoints.length} stack{stacksWithEndpoints.length !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {activeCount} active
            </span>
            {inactiveCount > 0 && (
              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                <span className="h-2 w-2 rounded-full bg-gray-500" />
                {inactiveCount} inactive
              </span>
            )}
          </div>
          <div className="flex items-center rounded-lg border p-1">
            <button
              onClick={() => setViewMode('stacks', 'grid')}
              className={cn(
                'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                viewMode === 'grid'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('stacks', 'table')}
              className={cn(
                'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                viewMode === 'table'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Table view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} className="h-[240px]" />
          ))}
        </div>
      ) : stacksWithEndpoints.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-medium">No stacks or compose projects detected</p>
          <p className="mt-1 text-sm text-muted-foreground">
            There are no Docker Stacks or Compose projects deployed across your endpoints
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {stacksWithEndpoints.map((stack) => (
            <StackCard
              key={stack.id}
              stack={stack}
              onClick={() => handleStackClick(stack)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <DataTable
            columns={columns}
            data={stacksWithEndpoints}
            searchKey="name"
            searchPlaceholder="Search stacks..."
            pageSize={15}
            onRowClick={handleStackClick}
          />
        </div>
      )}
    </div>
  );
}
