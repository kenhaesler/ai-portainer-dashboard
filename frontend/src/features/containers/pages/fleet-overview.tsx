import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Server, Layers, LayoutGrid, List, AlertTriangle, Boxes, Activity, Clock,
  ChevronLeft, ChevronRight, Search, ArrowRight, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useEndpoints, type Endpoint } from '@/features/containers/hooks/use-endpoints';
import { useStacks, type Stack } from '@/features/containers/hooks/use-stacks';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { DataTable } from '@/shared/components/data-table';
import { StatusBadge } from '@/shared/components/status-badge';
import { AutoRefreshToggle } from '@/shared/components/auto-refresh-toggle';
import { RefreshButton } from '@/shared/components/refresh-button';
import { SkeletonCard } from '@/shared/components/loading-skeleton';
import { useUiStore } from '@/stores/ui-store';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/spotlight-card';

const FLEET_GRID_PAGE_SIZE = 30;
const AUTO_TABLE_THRESHOLD = 100;

function formatRelativeTime(ms: number | null | undefined): string {
  if (ms == null) return 'N/A';
  const seconds = Math.floor(Math.abs(ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getSnapshotAgeColor(snapshotAge: number | null, thresholdMs = 5 * 60 * 1000): string {
  if (snapshotAge == null) return 'text-muted-foreground';
  if (snapshotAge < thresholdMs) return 'text-emerald-600 dark:text-emerald-400';
  if (snapshotAge < thresholdMs * 3) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function getStackType(type: number): string {
  switch (type) {
    case 1: return 'Swarm';
    case 2: return 'Compose';
    case 3: return 'Kubernetes';
    default: return `Type ${type}`;
  }
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleDateString();
}

function DiscoveredBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
      <Search className="h-3 w-3" />
      Discovered
    </span>
  );
}

function EndpointCard({ endpoint, onClick, onViewStacks }: { endpoint: Endpoint; onClick: () => void; onViewStacks?: () => void }) {
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
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              Edge Agent {endpoint.edgeMode === 'async' ? 'Async' : 'Standard'}
            </span>
            {endpoint.agentVersion && <span>v{endpoint.agentVersion}</span>}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              Check-in: {formatRelativeTime(endpoint.lastCheckIn ? Date.now() - endpoint.lastCheckIn * 1000 : null)}
            </span>
            <span className={cn('flex items-center gap-1', getSnapshotAgeColor(endpoint.snapshotAge))}>
              Snapshot: {formatRelativeTime(endpoint.snapshotAge)}
            </span>
          </div>
        </div>
      )}

      <p className="mt-4 truncate text-xs text-muted-foreground">{endpoint.url}</p>

      {onViewStacks && endpoint.stackCount > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onViewStacks(); }}
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          data-testid="view-stacks-link"
        >
          View {endpoint.stackCount} stack{endpoint.stackCount !== 1 ? 's' : ''}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </button>
  );
}

interface StackWithEndpoint extends Stack {
  endpointName: string;
}

function StackCard({ stack, onClick }: { stack: StackWithEndpoint; onClick: () => void }) {
  const isInferred = stack.source === 'compose-label';

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

export default function InfrastructurePage() {
  const navigate = useNavigate();
  const setPageViewMode = useUiStore((s) => s.setPageViewMode);

  // Fleet view mode (reuses existing 'fleet' key for preference persistence)
  const storedFleetViewMode = useUiStore((s) => s.pageViewModes['fleet']);
  const fleetViewMode = storedFleetViewMode ?? 'grid';
  const setFleetViewMode = (mode: 'grid' | 'table') => setPageViewMode('fleet', mode);
  const [gridPage, setGridPage] = useState(1);

  // Stacks view mode
  const stacksViewMode = useUiStore((s) => s.pageViewModes['stacks'] ?? 'grid');
  const setStacksViewMode = (mode: 'grid' | 'table') => setPageViewMode('stacks', mode);

  // Shared data — single hook call each, no duplicate requests
  const {
    data: endpoints,
    isLoading: endpointsLoading,
    isError: endpointsError,
    error: endpointErrorObj,
    refetch: refetchEndpoints,
    isFetching: endpointsFetching,
  } = useEndpoints();

  const {
    data: stacks,
    isLoading: stacksLoading,
    isError: stacksError,
    error: stacksErrorObj,
    refetch: refetchStacks,
    isFetching: stacksFetching,
  } = useStacks();

  const isLoading = endpointsLoading || stacksLoading;
  const isFetching = endpointsFetching || stacksFetching;

  // Shared auto-refresh preference
  const { interval, setInterval } = useAutoRefresh(30);

  // Cross-section filter: endpoint ID selected from fleet → filters stacks section
  const [stackEndpointFilter, setStackEndpointFilter] = useState<number | null>(null);
  const stacksSectionRef = useRef<HTMLElement>(null);

  const handleViewStacks = useCallback((endpointId: number) => {
    setStackEndpointFilter(endpointId);
    setTimeout(() => {
      stacksSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  // Combined force refresh — invalidates both caches then refetches, surfaces partial failures
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const forceRefresh = useCallback(async () => {
    setIsForceRefreshing(true);
    try {
      // Cache invalidation failures are non-fatal — swallow them silently
      await Promise.allSettled([
        api.request('/api/admin/cache/invalidate', { method: 'POST', params: { resource: 'endpoints' } }),
        api.request('/api/admin/cache/invalidate', { method: 'POST', params: { resource: 'stacks' } }),
      ]);
      const [epResult, stackResult] = await Promise.allSettled([refetchEndpoints(), refetchStacks()]);
      const failed: string[] = [];
      if (epResult.status === 'rejected') failed.push('endpoints');
      if (stackResult.status === 'rejected') failed.push('stacks');
      if (failed.length > 0) {
        toast.error(`Failed to refresh ${failed.join(' and ')}`);
      }
    } finally {
      setIsForceRefreshing(false);
    }
  }, [refetchEndpoints, refetchStacks]);

  const handleRefresh = useCallback(() => {
    void refetchEndpoints();
    void refetchStacks();
  }, [refetchEndpoints, refetchStacks]);

  // Auto-switch fleet to table view when > 100 endpoints (only if user hasn't chosen)
  useEffect(() => {
    if (!storedFleetViewMode && endpoints && endpoints.length > AUTO_TABLE_THRESHOLD) {
      setPageViewMode('fleet', 'table');
    }
  }, [endpoints, storedFleetViewMode, setPageViewMode]);

  // Reset grid page when endpoint list changes
  useEffect(() => {
    setGridPage(1);
  }, [endpoints?.length]);

  // Enrich stacks with endpoint names using the shared endpoints data
  const stacksWithEndpoints = useMemo<StackWithEndpoint[]>(() => {
    if (!stacks || !endpoints) return [];
    return stacks.map(stack => ({
      ...stack,
      endpointName: endpoints.find(ep => ep.id === stack.endpointId)?.name || `Endpoint ${stack.endpointId}`,
    }));
  }, [stacks, endpoints]);

  // Stacks filtered by the cross-section endpoint selection (null = show all)
  const displayedStacks = useMemo(
    () => stackEndpointFilter !== null
      ? stacksWithEndpoints.filter(s => s.endpointId === stackEndpointFilter)
      : stacksWithEndpoints,
    [stacksWithEndpoints, stackEndpointFilter],
  );

  // Summary bar counts
  const endpointUpCount = endpoints?.filter(ep => ep.status === 'up').length ?? 0;
  const endpointDownCount = endpoints?.filter(ep => ep.status === 'down').length ?? 0;
  const stackActiveCount = stacksWithEndpoints.filter(s => s.status === 'active').length;
  const stackInactiveCount = stacksWithEndpoints.filter(s => s.status === 'inactive').length;

  // Fleet grid pagination
  const gridPageCount = endpoints ? Math.ceil(endpoints.length / FLEET_GRID_PAGE_SIZE) : 0;
  const paginatedEndpoints = useMemo(() => {
    if (!endpoints) return [];
    const start = (gridPage - 1) * FLEET_GRID_PAGE_SIZE;
    return endpoints.slice(start, start + FLEET_GRID_PAGE_SIZE);
  }, [endpoints, gridPage]);

  const handleEndpointClick = (endpointId: number) => {
    navigate(`/workloads?endpoint=${endpointId}`);
  };

  const handleStackClick = (stack: StackWithEndpoint) => {
    navigate(`/workloads?endpoint=${stack.endpointId}&stack=${encodeURIComponent(stack.name)}`);
  };

  const endpointColumns: ColumnDef<Endpoint, unknown>[] = useMemo(() => [
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
      cell: ({ row }) => row.original.isEdge ? (
        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Edge Agent {row.original.edgeMode === 'async' ? 'Async' : 'Standard'}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Agent</span>
      ),
    },
    {
      id: 'lastCheckIn',
      header: 'Last Check-in',
      cell: ({ row }) => row.original.isEdge ? (
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(row.original.lastCheckIn ? Date.now() - row.original.lastCheckIn * 1000 : null)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      id: 'snapshotAge',
      header: 'Snapshot Age',
      cell: ({ row }) => row.original.isEdge ? (
        <span className={cn('text-xs', getSnapshotAgeColor(row.original.snapshotAge))}>
          {formatRelativeTime(row.original.snapshotAge)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
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

  const stackColumns: ColumnDef<StackWithEndpoint, unknown>[] = useMemo(() => [
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

  const hasError = endpointsError || stacksError;
  const errorMessage = endpointsError
    ? (endpointErrorObj instanceof Error ? endpointErrorObj.message : 'Failed to load endpoints')
    : (stacksErrorObj instanceof Error ? stacksErrorObj.message : 'Failed to load stacks');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Infrastructure</h1>
          <p className="text-muted-foreground">
            Endpoints and compose stacks across your fleet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton
            onClick={handleRefresh}
            onForceRefresh={forceRefresh}
            isLoading={isFetching || isForceRefreshing}
          />
        </div>
      </div>

      {/* Shared summary bar */}
      {!isLoading && (
        <SpotlightCard>
        <div
          className="flex flex-wrap items-center gap-6 rounded-lg border bg-card px-6 py-4 shadow-sm text-sm"
          data-testid="summary-bar"
        >
          <div className="flex items-center gap-3">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground" data-testid="endpoint-total">
              {endpoints?.length ?? 0} endpoint{(endpoints?.length ?? 0) !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1" data-testid="endpoint-up">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {endpointUpCount} up
            </span>
            {endpointDownCount > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400" data-testid="endpoint-down">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {endpointDownCount} down
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-3">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground" data-testid="stack-total">
              {stacksWithEndpoints.length} stack{stacksWithEndpoints.length !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1" data-testid="stack-active">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {stackActiveCount} active
            </span>
            {stackInactiveCount > 0 && (
              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400" data-testid="stack-inactive">
                <span className="h-2 w-2 rounded-full bg-gray-500" />
                {stackInactiveCount} inactive
              </span>
            )}
          </div>
        </div>
        </SpotlightCard>
      )}

      {/* Error state */}
      {hasError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load infrastructure data</p>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
          <button
            onClick={handleRefresh}
            className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      )}

      {/* Fleet Overview section */}
      <section aria-labelledby="fleet-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <h2 id="fleet-heading" className="text-xl font-semibold">Fleet Overview</h2>
          </div>
          {!isLoading && endpoints && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center rounded-lg border p-1">
                <button
                  onClick={() => setFleetViewMode('grid')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    fleetViewMode === 'grid'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setFleetViewMode('table')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    fleetViewMode === 'table'
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
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} className="h-[220px]" />
            ))}
          </div>
        ) : endpoints && fleetViewMode === 'grid' ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {paginatedEndpoints.map((endpoint) => (
                <EndpointCard
                  key={endpoint.id}
                  endpoint={endpoint}
                  onClick={() => handleEndpointClick(endpoint.id)}
                  onViewStacks={() => handleViewStacks(endpoint.id)}
                />
              ))}
            </div>
            {gridPageCount > 1 && (
              <div className="flex items-center justify-between" data-testid="grid-pagination">
                <p className="text-sm text-muted-foreground">
                  Page {gridPage} of {gridPageCount} ({endpoints.length} endpoints)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
                    onClick={() => setGridPage((p) => Math.max(1, p - 1))}
                    disabled={gridPage <= 1}
                    data-testid="grid-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
                    onClick={() => setGridPage((p) => Math.min(gridPageCount, p + 1))}
                    disabled={gridPage >= gridPageCount}
                    data-testid="grid-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : endpoints && fleetViewMode === 'table' ? (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <DataTable
              columns={endpointColumns}
              data={endpoints}
              searchKey="name"
              searchPlaceholder="Search endpoints..."
              pageSize={15}
              onRowClick={(row) => handleEndpointClick(row.id)}
            />
          </div>
          </SpotlightCard>
        ) : null}
      </section>

      {/* Stack Overview section */}
      <section ref={stacksSectionRef} aria-labelledby="stacks-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <h2 id="stacks-heading" className="text-xl font-semibold">Stack Overview</h2>
            {stackEndpointFilter !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {endpoints?.find(ep => ep.id === stackEndpointFilter)?.name ?? `Endpoint ${stackEndpointFilter}`}
                <button
                  onClick={() => setStackEndpointFilter(null)}
                  className="ml-0.5 rounded-full hover:bg-primary/20"
                  aria-label="Clear endpoint filter"
                  data-testid="clear-stack-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
          {!isLoading && stacksWithEndpoints.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {displayedStacks.length}{stackEndpointFilter !== null ? ` of ${stacksWithEndpoints.length}` : ''} stack{displayedStacks.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center rounded-lg border p-1">
                <button
                  onClick={() => setStacksViewMode('grid')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    stacksViewMode === 'grid'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setStacksViewMode('table')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    stacksViewMode === 'table'
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
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} className="h-[240px]" />
            ))}
          </div>
        ) : displayedStacks.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <Layers className="mx-auto h-10 w-10 text-muted-foreground" />
            {stackEndpointFilter !== null ? (
              <>
                <p className="mt-4 font-medium">No stacks for this endpoint</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The selected endpoint has no Docker Stacks or Compose projects
                </p>
                <button
                  onClick={() => setStackEndpointFilter(null)}
                  className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  Show all stacks
                </button>
              </>
            ) : (
              <>
                <p className="mt-4 font-medium">No stacks or compose projects detected</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  There are no Docker Stacks or Compose projects deployed across your endpoints
                </p>
              </>
            )}
          </div>
        ) : stacksViewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayedStacks.map((stack) => (
              <StackCard
                key={stack.id}
                stack={stack}
                onClick={() => handleStackClick(stack)}
              />
            ))}
          </div>
        ) : (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <DataTable
              columns={stackColumns}
              data={displayedStacks}
              searchKey="name"
              searchPlaceholder="Search stacks..."
              pageSize={15}
              onRowClick={handleStackClick}
            />
          </div>
          </SpotlightCard>
        )}
      </section>
    </div>
  );
}
