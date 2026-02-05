import { useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, X } from 'lucide-react';
import { useContainers, type Container } from '@/hooks/use-containers';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { FavoriteButton } from '@/components/shared/favorite-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatDate, truncate } from '@/lib/utils';

export default function WorkloadExplorerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read endpoint and stack from URL params
  const endpointParam = searchParams.get('endpoint');
  const stackParam = searchParams.get('stack');
  const selectedEndpoint = endpointParam ? Number(endpointParam) : undefined;
  const selectedStack = stackParam || undefined;

  const setFilters = (endpointId: number | undefined, stackName: string | undefined) => {
    const params: Record<string, string> = {};
    if (endpointId !== undefined) {
      params.endpoint = String(endpointId);
    }
    if (stackName) {
      params.stack = stackName;
    }
    setSearchParams(params);
  };

  const setSelectedEndpoint = (endpointId: number | undefined) => {
    setFilters(endpointId, selectedStack);
  };

  const setSelectedStack = (stackName: string | undefined) => {
    setFilters(selectedEndpoint, stackName);
  };

  const clearStackFilter = () => {
    setFilters(selectedEndpoint, undefined);
  };

  const { data: endpoints } = useEndpoints();
  const { data: containers, isLoading, isError, error, refetch, isFetching } = useContainers(selectedEndpoint);
  const { interval, setInterval } = useAutoRefresh(30);

  // Filter containers by stack if stack parameter is present
  const filteredContainers = useMemo(() => {
    if (!containers || !selectedStack) return containers;
    return containers.filter(c => c.labels['com.docker.compose.project'] === selectedStack);
  }, [containers, selectedStack]);

  const columns: ColumnDef<Container, any>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      size: 280,
      cell: ({ row, getValue }) => {
        const container = row.original;
        return (
          <div className="flex items-center gap-1">
            <FavoriteButton size="sm" endpointId={container.endpointId} containerId={container.id} />
            <button
              onClick={() => navigate(`/containers/${container.endpointId}/${container.id}`)}
              className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/20 hover:shadow-sm hover:ring-1 hover:ring-primary/20"
            >
              {truncate(getValue<string>(), 45)}
            </button>
          </div>
        );
      },
    },
    {
      accessorKey: 'image',
      header: 'Image',
      cell: ({ getValue }) => (
        <span className="inline-flex items-center rounded-md bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground">
          {truncate(getValue<string>(), 50)}
        </span>
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
        return (
          <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            {container.endpointName}
          </span>
        );
      },
    },
    {
      accessorKey: 'created',
      header: 'Created',
      cell: ({ getValue }) => formatDate(new Date(getValue<number>() * 1000)),
    },
  ], [navigate]);

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

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
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
        </div>

        {selectedStack && (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 dark:border-blue-900/30 dark:bg-blue-900/20">
            <span className="text-sm font-medium text-blue-900 dark:text-blue-300">
              Stack: {selectedStack}
            </span>
            <button
              onClick={clearStackFilter}
              className="inline-flex items-center justify-center rounded-sm p-0.5 text-blue-700 hover:bg-blue-200 dark:text-blue-400 dark:hover:bg-blue-900/40"
              title="Clear stack filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {filteredContainers && (
          <span className="text-sm text-muted-foreground">
            {filteredContainers.length} container{filteredContainers.length !== 1 ? 's' : ''}
            {selectedStack && containers && filteredContainers.length !== containers.length && (
              <span className="ml-1">
                (of {containers.length} total)
              </span>
            )}
          </span>
        )}
      </div>

      {/* Container Table */}
      {isLoading ? (
        <SkeletonCard className="h-[500px]" />
      ) : filteredContainers ? (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <DataTable
            columns={columns}
            data={filteredContainers}
            searchKey="name"
            searchPlaceholder="Search containers by name..."
            pageSize={15}
          />
        </div>
      ) : null}
    </div>
  );
}
