import { lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Star, ShieldAlert } from 'lucide-react';
import { useDashboardFull } from '@/features/core/hooks/use-dashboard-full';
import { useContainers, useFavoriteContainers } from '@/features/containers/hooks/use-containers';
import { calculateHealthStats } from '@/shared/lib/health-score';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { KpiCard } from '@/shared/components/data-display/kpi-card';
import { FleetHealthSummary } from '@/features/ai-intelligence/components/fleet-health-summary';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { SkeletonKpi, SkeletonChart } from '@/shared/components/feedback/skeleton';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { FavoriteButton } from '@/shared/components/ui/favorite-button';
import { useFavoritesStore } from '@/stores/favorites-store';
import { MotionPage, MotionReveal, MotionStagger } from '@/shared/components/layout/motion-page';
import { TiltCard } from '@/shared/components/data-display/tilt-card';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

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

  // Containers feed the Overall Health Score row. Uses the same
  // helpers as the Health & Monitoring page so the two views never disagree.
  const {
    data: containers,
    isLoading: isLoadingContainers,
    isError: isContainersError,
  } = useContainers();
  const healthStats = useMemo(() => {
    if (!containers) return null;
    return calculateHealthStats(containers);
  }, [containers]);

  const endpointChartData = useMemo(() => {
    if (!endpoints) return [];
    return endpoints.map((ep) => ({
      id: ep.id,
      name: ep.name,
      running: ep.containersRunning,
      stopped: ep.containersStopped,
      total: ep.totalContainers,
      status: ep.status,
      snapshotSource: ep.snapshotSource,
      snapshotFetchedAt: ep.snapshotFetchedAt,
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

  if (isError) {
    return (
      <MotionPage>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Home</h1>
          <p className="text-muted-foreground">
            Dashboard overview with KPIs and charts
          </p>
        </div>
        <EmptyState
          variant="error"
          icon={AlertTriangle}
          title="Failed to load dashboard"
          description={error instanceof Error ? error.message : 'An unexpected error occurred'}
        />
        <button
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
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
          <RefreshControls interval={interval} onIntervalChange={setInterval} onRefresh={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {/* Overall Health Score (4 fr) + Security Findings (1 fr) — single hero
          row that answers "is everything OK?" at a glance. The health pane
          reuses FleetHealthSummary so Home shows the same score and inner stat
          tiles as the Health & Monitoring page and the two can never drift. */}
      <MotionStagger className="grid grid-cols-1 gap-8 lg:grid-cols-5" stagger={0.05}>
        <MotionReveal className="h-full lg:col-span-4">
          {isContainersError ? (
            <EmptyState
              variant="error"
              icon={AlertTriangle}
              title="Failed to load fleet health"
              description="Could not compute the Overall Health Score from container data."
            />
          ) : (
            <SpotlightCard>
              <FleetHealthSummary stats={healthStats} isLoading={isLoadingContainers} />
            </SpotlightCard>
          )}
        </MotionReveal>
        <MotionReveal className="h-full lg:col-span-1">
          {isLoading ? (
            <SkeletonKpi className="h-full" />
          ) : data ? (
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
          ) : null}
        </MotionReveal>
      </MotionStagger>

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
        <SkeletonChart size="lg" />
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
          <SkeletonChart size="lg" className="lg:col-span-2" />
          <SkeletonChart size="lg" />
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
