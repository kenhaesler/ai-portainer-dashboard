import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Server, LayoutGrid, List, AlertTriangle, Boxes, Activity } from 'lucide-react';
import { useEndpoints, type Endpoint } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn } from '@/lib/utils';

type ViewMode = 'grid' | 'table';

function EndpointCard({ endpoint, onClick }: { endpoint: Endpoint; onClick: () => void }) {
  const memoryGB = (endpoint.totalMemory / (1024 * 1024 * 1024)).toFixed(1);

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border bg-card p-6 shadow-sm text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'rounded-lg p-2',
            endpoint.status === 'up'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}>
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">{endpoint.name}</h3>
            <p className="text-xs text-muted-foreground">ID: {endpoint.id}</p>
          </div>
        </div>
        <StatusBadge status={endpoint.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Containers</p>
          <div className="mt-1 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{endpoint.totalContainers}</span>
            <span className="text-xs text-muted-foreground">
              ({endpoint.containersRunning} running)
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Stacks</p>
          <p className="mt-1 font-medium">{endpoint.stackCount}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">CPU Cores</p>
          <div className="mt-1 flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{endpoint.totalCpu}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Memory</p>
          <p className="mt-1 font-medium">{memoryGB} GB</p>
        </div>
      </div>

      {endpoint.isEdge && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            Edge
          </span>
          {endpoint.agentVersion && <span>v{endpoint.agentVersion}</span>}
        </div>
      )}

      <p className="mt-4 truncate text-xs text-muted-foreground">{endpoint.url}</p>
    </button>
  );
}

export default function FleetOverviewPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const navigate = useNavigate();

  const { data: endpoints, isLoading, isError, error, refetch, isFetching } = useEndpoints();
  const { interval, setInterval } = useAutoRefresh(30);

  const handleEndpointClick = (endpointId: number) => {
    navigate(`/workload-explorer?endpoint=${endpointId}`);
  };

  const columns: ColumnDef<Endpoint, unknown>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">(ID: {row.original.id})</span>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
    },
    {
      accessorKey: 'totalContainers',
      header: 'Containers',
      cell: ({ row }) => (
        <span>
          {row.original.totalContainers}
          <span className="ml-1 text-xs text-muted-foreground">
            ({row.original.containersRunning} running)
          </span>
        </span>
      ),
    },
    {
      accessorKey: 'stackCount',
      header: 'Stacks',
    },
    {
      accessorKey: 'totalCpu',
      header: 'CPU Cores',
    },
    {
      accessorKey: 'totalMemory',
      header: 'Memory',
      cell: ({ getValue }) => {
        const bytes = getValue<number>();
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      },
    },
    {
      accessorKey: 'isEdge',
      header: 'Type',
      cell: ({ getValue }) => getValue<boolean>() ? (
        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Edge
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Standard</span>
      ),
    },
    {
      accessorKey: 'url',
      header: 'URL',
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">{getValue<string>()}</span>
      ),
    },
  ], []);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fleet Overview</h1>
          <p className="text-muted-foreground">
            Monitor all Docker endpoints in your fleet
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load endpoints</p>
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

  const upCount = endpoints?.filter(ep => ep.status === 'up').length ?? 0;
  const downCount = endpoints?.filter(ep => ep.status === 'down').length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fleet Overview</h1>
          <p className="text-muted-foreground">
            Monitor all Docker endpoints in your fleet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Summary and View Toggle */}
      {!isLoading && endpoints && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {upCount} up
            </span>
            {downCount > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {downCount} down
              </span>
            )}
          </div>
          <div className="flex items-center rounded-lg border p-1">
            <button
              onClick={() => setViewMode('grid')}
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
              onClick={() => setViewMode('table')}
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
            <SkeletonCard key={i} className="h-[220px]" />
          ))}
        </div>
      ) : endpoints && viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {endpoints.map((endpoint) => (
            <EndpointCard
              key={endpoint.id}
              endpoint={endpoint}
              onClick={() => handleEndpointClick(endpoint.id)}
            />
          ))}
        </div>
      ) : endpoints && viewMode === 'table' ? (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <DataTable
            columns={columns}
            data={endpoints}
            searchKey="name"
            searchPlaceholder="Search endpoints..."
            pageSize={15}
            onRowClick={(row) => handleEndpointClick(row.id)}
          />
        </div>
      ) : null}
    </div>
  );
}
