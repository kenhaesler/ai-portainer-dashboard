import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Star, ShieldAlert, PackageOpen } from 'lucide-react';
import { useDashboardFull } from '@/features/core/hooks/use-dashboard-full';
import { useContainers, useFavoriteContainers } from '@/features/containers/hooks/use-containers';
import { calculateHealthStats } from '@/shared/lib/health-score';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { FleetHealthSummary } from '@/features/ai-intelligence/components/fleet-health-summary';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { DataFreshness } from '@/shared/components/feedback/data-freshness';
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
import { PageHeader } from '@/shared/components/layout/page-header';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { FavoriteButton } from '@/shared/components/ui/favorite-button';
import { useFavoritesStore } from '@/stores/favorites-store';
import { MotionPage, MotionReveal, MotionStagger } from '@/shared/components/layout/motion-page';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

// Lazy-loaded chart components — lets KPI cards render first
const EndpointHealthOctagons = lazy(() => import('@/shared/components/charts/endpoint-health-octagons').then(m => ({ default: m.EndpointHealthOctagons })));
const WorkloadTopBar = lazy(() => import('@/shared/components/charts/workload-top-bar').then(m => ({ default: m.WorkloadTopBar })));
const ResourceOverviewCard = lazy(() => import('@/shared/components/charts/resource-overview-card').then(m => ({ default: m.ResourceOverviewCard })));

function ChartSkeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/50 ${className ?? 'h-[200px]'}`} />;
}

const PAGE_TITLE = 'Home';

export default function HomePage() {
  const navigate = useNavigate();
  // Unified fetch: summary + resources + endpoints in one request
  const {
    data: fullData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useDashboardFull(8);
  const data = fullData?.summary;
  const resourcesData = fullData?.resources;
  const endpoints = fullData?.endpoints;
  const isLoadingResources = isLoading;
  const { forceRefresh, isForceRefreshing } = useForceRefresh('endpoints', refetch);
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const { data: favoriteContainers = [] } = useFavoriteContainers(favoriteIds);

  // Containers feed the Fleet Vitals hero. Uses the same helpers as the
  // Health & Monitoring page so the two views never disagree.
  const {
    data: containers,
    isLoading: isLoadingContainers,
    isError: isContainersError,
    refetch: refetchContainers,
  } = useContainers();

  // The refresh dropdown now schedules the fetches it advertises. It used to
  // write a localStorage preference and nothing else: this page armed no timer,
  // `useContainers` sets no `refetchInterval`, and the control still rendered a
  // pulsing "live" dot — so the hero's health numbers were frozen at mount with
  // nothing on screen to say so. `DataFreshness` beside the control is the
  // second signal that makes a stalled poll visible.
  const handleTick = useCallback(() => {
    refetch();
    refetchContainers?.();
  }, [refetch, refetchContainers]);
  const { interval, setRefreshInterval } = useAutoRefresh(30, { onTick: handleTick });

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
      // A bar you can click has to land somewhere real: the chart used to
      // navigate to `/endpoints/:id`, a route this router does not define.
      href: `/workloads?stack=${encodeURIComponent(stack.name)}`,
    }));
  }, [resourcesData]);

  // Live state, not a description of the page's own widgets. The previous
  // subtitle ("Dashboard overview with KPIs and charts") named the furniture
  // and restated the title.
  const subtitle = data
    ? `${data.kpis.endpoints} endpoint${data.kpis.endpoints === 1 ? '' : 's'} · ` +
      `${data.kpis.total} container${data.kpis.total === 1 ? '' : 's'}`
    : undefined;

  const headerActions = (
    <>
      <DataFreshness lastUpdated={dataUpdatedAt || null} onRefresh={() => refetch()} />
      <RefreshControls
        interval={interval}
        onIntervalChange={setRefreshInterval}
        onRefresh={() => refetch()}
        onForceRefresh={forceRefresh}
        isLoading={isFetching || isForceRefreshing}
      />
    </>
  );

  if (isError) {
    return (
      <MotionPage>
        <PageHeader title={PAGE_TITLE} />
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
      <PageHeader title={PAGE_TITLE} subtitle={subtitle} actions={headerActions} />

      {/* Fleet Vitals — full-width hero. Security Findings and Stopped live
          INSIDE the pane as extra stat tiles (below the container-status
          tiles), reusing FleetHealthSummary so Home and Health & Monitoring
          never drift. */}
      <MotionStagger stagger={0.05}>
        <MotionReveal>
          {isContainersError ? (
            <EmptyState
              variant="error"
              icon={AlertTriangle}
              title="Failed to load fleet health"
              description="Could not read container health from Portainer."
            />
          ) : (
            <SpotlightCard>
              <FleetHealthSummary
                stats={healthStats}
                isLoading={isLoadingContainers}
                statusColumns={3}
                extraTiles={[
                  {
                    icon: PackageOpen,
                    label: 'Stopped',
                    value: healthStats?.stopped ?? 0,
                    // No link at zero: a chevron into an empty filtered table
                    // is the dead end this was meant to fix.
                    // `state=stopped`, not `state=exited`: the explorer filters
                    // on the contract vocabulary, so the old URL landed on
                    // "No results." and "0 containers across 0 endpoints".
                    to: (healthStats?.stopped ?? 0) > 0 ? '/workloads?state=stopped' : undefined,
                  },
                  {
                    icon: ShieldAlert,
                    label: 'Security Findings',
                    value: data?.security.flagged ?? 0,
                    variant: (data?.security.flagged ?? 0) > 0 ? 'danger' : 'default',
                    // Always linked: the audit page is worth opening at zero
                    // findings too — it shows what was actually checked.
                    to: '/security/audit',
                  },
                ]}
              />
            </SpotlightCard>
          )}
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

      {/* Fleet resources — two fleet-wide gauges. These used to sit inside a
          card titled "Top Workloads" that contained no workloads. */}
      {isLoading || isLoadingResources ? (
        <SkeletonChart size="md" />
      ) : resourcesData ? (
        <MotionReveal>
          <SpotlightCard>
            <div className="rounded-lg border bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">Fleet Resources</h3>
              <Suspense fallback={<ChartSkeleton className="h-[88px]" />}>
                <ResourceOverviewCard
                  cpuPercent={resourcesData.fleetCpuPercent}
                  memoryPercent={resourcesData.fleetMemoryPercent}
                />
              </Suspense>
            </div>
          </SpotlightCard>
        </MotionReveal>
      ) : null}

      {/* Endpoint health + stacks. Two panes across the full width so a wide
          display carries content rather than gradient; the Fleet Summary card
          that used to sit here restated "everything is running" a third and
          fourth time (a 100%/0% complement bar and a one-row "Top
          Contributors" ranking) and was deleted rather than restyled. */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SkeletonChart size="lg" className="xl:col-span-2" />
          <SkeletonChart size="lg" />
        </div>
      ) : data && resourcesData ? (
        <MotionStagger className="grid grid-cols-1 gap-4 xl:grid-cols-3" stagger={0.05}>
          <MotionReveal className="xl:col-span-2">
            <SpotlightCard>
              <div className="flex h-full min-h-[360px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">Endpoint Health</h3>
                <Suspense fallback={<ChartSkeleton className="h-[200px]" />}>
                  <EndpointHealthOctagons endpoints={endpointChartData} />
                </Suspense>
              </div>
            </SpotlightCard>
          </MotionReveal>
          <MotionReveal>
            <SpotlightCard>
              <div className="flex h-full min-h-[360px] flex-col rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                  Stacks by container count
                </h3>
                <Suspense fallback={<ChartSkeleton className="flex-1" />}>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <WorkloadTopBar series={stackChartData} />
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
