import { lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Boxes, PackageOpen, Layers, AlertTriangle, Star, ShieldAlert } from 'lucide-react';
import { useDashboardFull } from '@/features/core/hooks/use-dashboard-full';
import { useFavoriteContainers } from '@/features/containers/hooks/use-containers';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { useKpiHistory } from '@/features/observability/hooks/use-kpi-history';
import { KpiCard } from '@/shared/components/kpi-card';
import { StatusBadge } from '@/shared/components/status-badge';
import { SkeletonCard } from '@/shared/components/loading-skeleton';
import { AutoRefreshToggle } from '@/shared/components/auto-refresh-toggle';
import { RefreshButton } from '@/shared/components/refresh-button';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { FavoriteButton } from '@/shared/components/favorite-button';
import { useFavoritesStore } from '@/stores/favorites-store';
import { MotionPage, MotionReveal, MotionStagger } from '@/shared/components/motion-page';
import { TiltCard } from '@/shared/components/tilt-card';
import { SpotlightCard } from '@/shared/components/spotlight-card';

// Lazy-loaded chart components — lets KPI cards render first
const EndpointHealthOctagons = lazy(() => import('@/shared/components/charts/endpoint-health-octagons').then(m => ({ default: m.EndpointHealthOctagons })));
const WorkloadTopBar = lazy(() => import('@/shared/components/charts/workload-top-bar').then(m => ({ default: m.WorkloadTopBar })));
const FleetSummaryCard = lazy(() => import('@/shared/components/charts/fleet-summary-card').then(m => ({ default: m.FleetSummaryCard })));
const ResourceOverviewCard = lazy(() => import('@/shared/components/charts/resource-overview-card').then(m => ({ default: m.ResourceOverviewCard })));

function ChartSkeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/50 ${className ?? 'h-[200px]'}`} />;
}

export default function HomePage() {
  const navigate = useNavigate();
  // Unified fetch: summary + resources + endpoints in one request
  const { data: fullData, isLoading, isError, error, refetch, isFetching } = useDashboardFull(8);
  const data = fullData?.summary;
  const resourcesData = fullData?.resources;
  const endpoints = fullData?.endpoints;
  const isLoadingResources = isLoading;
  const { forceRefresh, isForceRefreshing } = useForceRefresh('endpoints', refetch);
  const { interval, setInterval } = useAutoRefresh(30);
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const { data: favoriteContainers = [] } = useFavoriteContainers(favoriteIds);
  const { data: kpiHistory } = useKpiHistory(24);

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

  const stackChartData = useMemo(() => {
    if (!resourcesData?.topStacks) return [];
    return resourcesData.topStacks.map((stack) => ({
      name: stack.name,
      running: stack.runningCount,
      stopped: stack.stoppedCount,
      total: stack.containerCount,
    }));
  }, [resourcesData]);

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
            Dashboard overview with KPIs and charts
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Home</h1>
          <p className="text-muted-foreground">
            Dashboard overview with KPIs and charts
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

      {/* Endpoint Health — full width, dynamic height */}
      {isLoading ? (
        <SkeletonCard className="h-[300px]" />
      ) : data ? (
        <MotionReveal>
          <SpotlightCard>
            <div className="flex flex-col rounded-lg border bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                Endpoint Health
              </h3>
              <Suspense fallback={<ChartSkeleton className="h-[200px]" />}>
                <EndpointHealthOctagons endpoints={endpointChartData} />
              </Suspense>
            </div>
          </SpotlightCard>
        </MotionReveal>
      ) : null}

      {/* Top Workloads + Fleet Summary */}
      {isLoading || isLoadingResources ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonCard className="h-[520px] lg:col-span-2" />
          <SkeletonCard className="h-[520px]" />
        </div>
      ) : data && resourcesData ? (
        <MotionStagger className="grid grid-cols-1 gap-4 lg:grid-cols-3" stagger={0.05}>
            <MotionReveal className="lg:col-span-2">
              <SpotlightCard>
                <div className="flex h-[520px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                  <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                    Top Workloads
                  </h3>
                  <Suspense fallback={<ChartSkeleton className="h-[60px] mb-4" />}>
                    <div className="mb-4">
                      <ResourceOverviewCard
                        cpuPercent={resourcesData.fleetCpuPercent}
                        memoryPercent={resourcesData.fleetMemoryPercent}
                      />
                    </div>
                  </Suspense>
                  <Suspense fallback={<ChartSkeleton className="flex-1" />}>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <WorkloadTopBar endpoints={stackChartData} />
                    </div>
                  </Suspense>
                </div>
              </SpotlightCard>
            </MotionReveal>
            <MotionReveal>
              <SpotlightCard>
                <div className="flex h-[520px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                  <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                    Fleet Summary
                  </h3>
                  <Suspense fallback={<ChartSkeleton className="flex-1" />}>
                    <div className="flex-1 min-h-0">
                      <FleetSummaryCard
                        endpoints={endpointChartData}
                        totalContainers={data.kpis.total}
                      />
                    </div>
                  </Suspense>
                </div>
              </SpotlightCard>
            </MotionReveal>
          </MotionStagger>
      ) : null}

    </MotionPage>
  );
}
