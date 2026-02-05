import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Server, Boxes, PackageOpen, Layers, AlertTriangle, Star } from 'lucide-react';
import { useDashboard, type NormalizedContainer } from '@/hooks/use-dashboard';
import { useContainers } from '@/hooks/use-containers';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { FavoriteButton } from '@/components/shared/favorite-button';
import { ContainerStatePie } from '@/components/charts/container-state-pie';
import { EndpointStatusBar } from '@/components/charts/endpoint-status-bar';
import { WorkloadDistribution } from '@/components/charts/workload-distribution';
import { useFavoritesStore } from '@/stores/favorites-store';
import { formatDate, truncate } from '@/lib/utils';

export default function HomePage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('endpoints', refetch);
  const { interval, setInterval } = useAutoRefresh(30);
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const { data: allContainers } = useContainers();

  const favoriteContainers = useMemo(() => {
    if (!allContainers || favoriteIds.length === 0) return [];
    return allContainers.filter((c) =>
      favoriteIds.includes(`${c.endpointId}:${c.id}`),
    );
  }, [allContainers, favoriteIds]);

  const containerColumns: ColumnDef<NormalizedContainer, any>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row, getValue }) => {
        const container = row.original;
        return (
          <div className="flex items-center gap-1">
            <FavoriteButton size="sm" endpointId={container.endpointId} containerId={container.id} />
            <button
              onClick={() => navigate(`/containers/${container.endpointId}/${container.id}`)}
              className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/20 hover:shadow-sm hover:ring-1 hover:ring-primary/20"
            >
              {truncate(getValue<string>(), 40)}
            </button>
          </div>
        );
      },
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
  ], [navigate]);

  const endpointBarData = useMemo(() => {
    if (!data?.endpoints) return [];
    return data.endpoints.map((ep) => ({
      name: `${ep.name} (ID: ${ep.id})`,
      running: ep.containersRunning,
      stopped: ep.containersStopped,
      unhealthy: ep.containersUnhealthy,
    }));
  }, [data?.endpoints]);

  const workloadData = useMemo(() => {
    if (!data?.endpoints) return [];
    return data.endpoints.map((ep) => ({
      endpoint: `${ep.name} (ID: ${ep.id})`,
      containers: ep.totalContainers,
      running: ep.containersRunning,
      stopped: ep.containersStopped,
    }));
  }, [data?.endpoints]);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Home</h1>
          <p className="text-muted-foreground">
            Dashboard overview with KPIs, charts, and recent containers
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load dashboard</p>
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
          <h1 className="text-3xl font-bold tracking-tight">Home</h1>
          <p className="text-muted-foreground">
            Dashboard overview with KPIs, charts, and recent containers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Endpoints"
            value={data.kpis.endpoints}
            icon={<Server className="h-5 w-5" />}
            trendValue={`${data.kpis.endpointsUp} up`}
            trend={data.kpis.endpointsDown > 0 ? 'down' : 'up'}
          />
          <KpiCard
            label="Running Containers"
            value={data.kpis.running}
            icon={<Boxes className="h-5 w-5" />}
            trendValue={`of ${data.kpis.total} total`}
            trend="neutral"
          />
          <KpiCard
            label="Stopped Containers"
            value={data.kpis.stopped}
            icon={<PackageOpen className="h-5 w-5" />}
            trend={data.kpis.stopped > 0 ? 'down' : 'neutral'}
            trendValue={data.kpis.stopped > 0 ? `${data.kpis.stopped} stopped` : 'none'}
          />
          <KpiCard
            label="Stacks"
            value={data.kpis.stacks}
            icon={<Layers className="h-5 w-5" />}
          />
        </div>
      ) : null}

      {/* Pinned Favorites */}
      {favoriteContainers.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            Pinned Favorites
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {favoriteContainers.map((c) => (
              <div
                key={`${c.endpointId}:${c.id}`}
                className="group flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50"
              >
                <button
                  onClick={() => navigate(`/containers/${c.endpointId}/${c.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={c.state} />
                    <span className="truncate text-xs text-muted-foreground">
                      {c.endpointName}
                    </span>
                  </div>
                </button>
                <FavoriteButton
                  endpointId={c.endpointId}
                  containerId={c.id}
                  size="sm"
                  className="ml-2 shrink-0"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} className="h-[380px]" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Container States</h3>
            <ContainerStatePie
              running={data.kpis.running}
              stopped={data.kpis.stopped}
              unhealthy={data.kpis.unhealthy}
            />
          </div>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">
              Endpoint Status
            </h3>
            <EndpointStatusBar data={endpointBarData} />
          </div>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">
              Workload Distribution
            </h3>
            <WorkloadDistribution data={workloadData} />
          </div>
        </div>
      ) : null}

      {/* Recent Containers Table */}
      {isLoading ? (
        <SkeletonCard className="h-[400px]" />
      ) : data ? (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-medium text-muted-foreground">
            Recent Containers
          </h3>
          <DataTable
            columns={containerColumns}
            data={data.recentContainers}
            searchKey="name"
            searchPlaceholder="Filter containers..."
            pageSize={10}
          />
        </div>
      ) : null}
    </div>
  );
}
