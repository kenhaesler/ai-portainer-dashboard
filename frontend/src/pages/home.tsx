import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Server, Boxes, PackageOpen, Layers, AlertTriangle } from 'lucide-react';
import { useDashboard, type NormalizedContainer } from '@/hooks/use-dashboard';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { ContainerStatePie } from '@/components/charts/container-state-pie';
import { EndpointStatusBar } from '@/components/charts/endpoint-status-bar';
import { WorkloadDistribution } from '@/components/charts/workload-distribution';
import { formatDate, truncate } from '@/lib/utils';

const containerColumns: ColumnDef<NormalizedContainer, any>[] = [
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
  },
  {
    accessorKey: 'created',
    header: 'Created',
    cell: ({ getValue }) => formatDate(new Date(getValue<number>() * 1000)),
  },
];

export default function HomePage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard();
  const { interval, setInterval } = useAutoRefresh(30);

  const endpointBarData = useMemo(() => {
    if (!data?.endpoints) return [];
    return data.endpoints.map((ep) => ({
      name: ep.name,
      running: ep.containersRunning,
      stopped: ep.containersStopped,
      unhealthy: ep.containersUnhealthy,
    }));
  }, [data?.endpoints]);

  const workloadData = useMemo(() => {
    if (!data?.endpoints) return [];
    return data.endpoints.map((ep) => ({
      endpoint: ep.name,
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
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
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
