import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Server, Boxes, PackageOpen, Layers, AlertTriangle, Star, ShieldAlert, Search } from 'lucide-react';
import { useDashboard, type NormalizedContainer } from '@/hooks/use-dashboard';
import { useFavoriteContainers } from '@/hooks/use-containers';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { useKpiHistory } from '@/hooks/use-kpi-history';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { FavoriteButton } from '@/components/shared/favorite-button';
import { ContainerStatePie } from '@/components/charts/container-state-pie';
import { EndpointHealthOctagons } from '@/components/charts/endpoint-health-octagons';
import { WorkloadTopBar } from '@/components/charts/workload-top-bar';
import { FleetSummaryCard } from '@/components/charts/fleet-summary-card';
import { useFavoritesStore } from '@/stores/favorites-store';
import { formatDate, truncate } from '@/lib/utils';
import { MotionPage, MotionReveal, MotionStagger } from '@/components/shared/motion-page';
import { TiltCard } from '@/components/shared/tilt-card';
import { SpotlightCard } from '@/components/shared/spotlight-card';

export default function HomePage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('endpoints', refetch);
  const { interval, setInterval } = useAutoRefresh(30);
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const { data: favoriteContainers = [] } = useFavoriteContainers(favoriteIds);
  const { data: endpoints } = useEndpoints();
  const { data: kpiHistory } = useKpiHistory(24);
  const [containerSearch, setContainerSearch] = useState('');

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

  const endpointChartData = useMemo(() => {
    if (!endpoints) return [];
    return endpoints.map((ep) => ({
      id: ep.id,
      name: ep.name,
      running: ep.containersRunning,
      stopped: ep.containersStopped,
      total: ep.totalContainers,
    }));
  }, [endpoints]);

  // Derive sparkline arrays from KPI history snapshots
  const sparklines = useMemo(() => {
    if (!kpiHistory || kpiHistory.length < 2) {
      return { endpoints: [], running: [], stopped: [], stacks: [] };
    }
    return {
      endpoints: kpiHistory.map((s) => s.endpoints),
      running: kpiHistory.map((s) => s.running),
      stopped: kpiHistory.map((s) => s.stopped),
      stacks: kpiHistory.map((s) => s.stacks),
    };
  }, [kpiHistory]);

  // Compute hover detail strings from history
  const hoverDetails = useMemo(() => {
    if (!kpiHistory || kpiHistory.length === 0) {
      return { endpoints: undefined, running: undefined, stopped: undefined, stacks: undefined };
    }
    const latest = kpiHistory[kpiHistory.length - 1];
    const oneHourAgo = kpiHistory.length > 12 ? kpiHistory[kpiHistory.length - 13] : kpiHistory[0];

    function detail(key: 'endpoints' | 'running' | 'stopped' | 'stacks') {
      const values = kpiHistory!.map((s) => s[key]);
      const peak = Math.max(...values);
      const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      const delta = latest[key] - oneHourAgo[key];
      const sign = delta >= 0 ? '+' : '';
      return `Last hour: ${sign}${delta} | Peak: ${peak} | Avg: ${avg}`;
    }

    return {
      endpoints: detail('endpoints'),
      running: detail('running'),
      stopped: detail('stopped'),
      stacks: detail('stacks'),
    };
  }, [kpiHistory]);

  if (isError) {
    return (
      <MotionPage>
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
      </MotionPage>
    );
  }

  return (
    <MotionPage>
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
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : data ? (
        <MotionStagger className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5" stagger={0.05}>
          <MotionReveal className="h-full">
            <TiltCard>
              <KpiCard
                label="Endpoints"
                value={data.kpis.endpoints}
                icon={<Server className="h-5 w-5" />}
                trendValue={`${data.kpis.endpointsUp} up`}
                trend={data.kpis.endpointsDown > 0 ? 'down' : 'up'}
                sparklineData={sparklines.endpoints}
                sparklineColor="var(--color-chart-1)"
                hoverDetail={hoverDetails.endpoints}
              />
            </TiltCard>
          </MotionReveal>
          <MotionReveal className="h-full">
            <TiltCard>
              <KpiCard
                label="Running Containers"
                value={data.kpis.running}
                icon={<Boxes className="h-5 w-5" />}
                trendValue={`of ${data.kpis.total} total`}
                trend="neutral"
                sparklineData={sparklines.running}
                sparklineColor="var(--color-chart-2)"
                hoverDetail={hoverDetails.running}
              />
            </TiltCard>
          </MotionReveal>
          <MotionReveal className="h-full">
            <TiltCard>
              <KpiCard
                label="Stopped Containers"
                value={data.kpis.stopped}
                icon={<PackageOpen className="h-5 w-5" />}
                trend={data.kpis.stopped > 0 ? 'down' : 'neutral'}
                trendValue={data.kpis.stopped > 0 ? `${data.kpis.stopped} stopped` : 'none'}
                sparklineData={sparklines.stopped}
                sparklineColor="var(--color-chart-3)"
                hoverDetail={hoverDetails.stopped}
              />
            </TiltCard>
          </MotionReveal>
          <MotionReveal className="h-full">
            <TiltCard>
              <KpiCard
                label="Stacks"
                value={data.kpis.stacks}
                icon={<Layers className="h-5 w-5" />}
                sparklineData={sparklines.stacks}
                sparklineColor="var(--color-chart-4)"
                hoverDetail={hoverDetails.stacks}
              />
            </TiltCard>
          </MotionReveal>
          <MotionReveal className="h-full">
            <TiltCard>
              <button
                type="button"
                onClick={() => navigate('/security/audit')}
                className="block h-full w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                <KpiCard
                  label="Security Findings"
                  value={data.security.flagged}
                  icon={<ShieldAlert className="h-5 w-5" />}
                  trendValue={`${data.security.ignored} ignored`}
                  trend={data.security.flagged > 0 ? 'down' : 'up'}
                  className="cursor-pointer"
                />
              </button>
            </TiltCard>
          </MotionReveal>
        </MotionStagger>
      ) : null}

      {/* Pinned Favorites */}
      {favoriteContainers.length > 0 && (
        <MotionReveal>
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
        </MotionReveal>
      )}

      {/* Row 3: Container States (1/3) + Endpoint Health Treemap (2/3) */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonCard className="h-[380px]" />
          <SkeletonCard className="h-[380px] lg:col-span-2" />
        </div>
      ) : data ? (
        <MotionStagger className="grid grid-cols-1 gap-4 lg:grid-cols-3" stagger={0.05}>
          <MotionReveal>
            <SpotlightCard>
              <div className="flex h-[380px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">Container States</h3>
                <div className="flex-1 min-h-0">
                  <ContainerStatePie
                    running={data.kpis.running}
                    stopped={data.kpis.stopped}
                    unhealthy={data.kpis.unhealthy}
                  />
                </div>
              </div>
            </SpotlightCard>
          </MotionReveal>
          <MotionReveal className="lg:col-span-2">
            <SpotlightCard>
              <div className="flex h-[380px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                  Endpoint Health
                </h3>
                <div className="flex-1 min-h-0">
                  <EndpointHealthOctagons endpoints={endpointChartData} />
                </div>
              </div>
            </SpotlightCard>
          </MotionReveal>
        </MotionStagger>
      ) : null}

      {/* Row 4: Top-10 Workload Bar (2/3) + Fleet Summary (1/3) */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonCard className="h-[420px] lg:col-span-2" />
          <SkeletonCard className="h-[420px]" />
        </div>
      ) : data ? (
        <MotionStagger className="grid grid-cols-1 gap-4 lg:grid-cols-3" stagger={0.05}>
          <MotionReveal className="lg:col-span-2">
            <SpotlightCard>
              <div className="flex h-[420px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                  Top Workloads
                </h3>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <WorkloadTopBar endpoints={endpointChartData} />
                </div>
              </div>
            </SpotlightCard>
          </MotionReveal>
          <MotionReveal>
            <SpotlightCard>
              <div className="flex h-[420px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                  Fleet Summary
                </h3>
                <div className="flex-1 min-h-0">
                  <FleetSummaryCard
                    endpoints={endpointChartData}
                    totalContainers={data.kpis.total}
                  />
                </div>
              </div>
            </SpotlightCard>
          </MotionReveal>
        </MotionStagger>
      ) : null}

      {/* Recent Containers Table */}
      {isLoading ? (
        <SkeletonCard className="h-[400px]" />
      ) : data ? (
        <MotionReveal>
          <SpotlightCard>
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
          </SpotlightCard>
        </MotionReveal>
      ) : null}
    </MotionPage>
  );
}
