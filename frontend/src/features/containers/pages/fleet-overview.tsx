import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Server, Layers, LayoutGrid, List, AlertTriangle,
  ChevronLeft, ChevronRight, Search, ArrowRight, X,
  Box,
} from 'lucide-react';
import { toast } from 'sonner';
import { useEndpoints, type Endpoint } from '@/features/containers/hooks/use-endpoints';
import { useStacks } from '@/features/containers/hooks/use-stacks';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { DataTable } from '@/shared/components/tables/data-table';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { RefreshButton } from '@/shared/components/ui/refresh-button';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { SkeletonText, SkeletonChart } from '@/shared/components/feedback/skeleton';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { FilterChipBar, type FilterChip } from '@/shared/components/ui/filter-chip-bar';
import { useUiStore } from '@/stores/ui-store';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { FleetStatusSummary } from '@/features/containers/components/fleet/fleet-status-summary';
import { FleetSearch } from '@/features/containers/components/fleet/fleet-search';
import { filterEndpoints, filterStacks, type StackWithEndpoint } from '@/features/containers/lib/fleet-search-filter';
import { useK8sPods, useK8sDeployments, useK8sServices, useK8sNamespaces, type K8sPod, type K8sDeployment, type K8sService } from '@/features/kubernetes/hooks/use-kubernetes';

const FLEET_GRID_PAGE_SIZE = 30;
const AUTO_TABLE_THRESHOLD = 100;
const ALL_FILTER = '__all__';

type InfraTab = 'fleet' | 'stacks' | 'kubernetes';
const VALID_TABS: InfraTab[] = ['fleet', 'stacks', 'kubernetes'];
const TAB_TRIGGER_CLASS =
  'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary';

function resolveTab(raw: string | null): InfraTab {
  if (raw && VALID_TABS.includes(raw as InfraTab)) return raw as InfraTab;
  return 'fleet';
}

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

function getEndpointTypeLabel(type: number): string {
  switch (type) {
    case 1: return 'Docker';
    case 2: return 'Agent';
    case 3: return 'Azure ACI';
    case 4: return 'Edge Agent';
    case 5: return 'Kubernetes';
    case 6: return 'Edge Agent (Kubernetes)';
    case 7: return 'Edge Agent (Async)';
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
      className="w-full rounded-lg border bg-card p-4 shadow-sm text-left text-sm transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {/* Row 1: Name + ID — matches table Name column (font-medium + muted ID) */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-medium">{endpoint.name}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">(ID: {endpoint.id})</span>
      </div>

      {/* Row 2: Agent type tag + Status badge — matches table Type + Status columns */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          {endpoint.isEdge ? (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              Edge Agent {endpoint.edgeMode === 'async' ? 'Async' : 'Standard'}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {getEndpointTypeLabel(endpoint.type)}
            </span>
          )}
          {endpoint.isEdge && endpoint.agentVersion && (
            <span className="text-muted-foreground">v{endpoint.agentVersion}</span>
          )}
        </div>
        <StatusBadge status={endpoint.status} />
      </div>

      {/* Row 3: Inline stats — matches table Containers/Stacks/CPU/Memory columns */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {endpoint.totalContainers}
          <span className="ml-1">({endpoint.containersRunning} running)</span>
        </span>
        <span>{endpoint.stackCount} stacks</span>
        <span>{endpoint.totalCpu} CPU</span>
        <span>{memoryGB} GB</span>
      </div>

      {/* Edge metadata (compact) — matches table Check-in + Snapshot columns */}
      {endpoint.isEdge && (
        <div className="mt-1.5 flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            Check-in: {formatRelativeTime(endpoint.lastCheckIn ? Date.now() - endpoint.lastCheckIn * 1000 : null)}
          </span>
          <span className={cn(getSnapshotAgeColor(endpoint.snapshotAge))}>
            Snapshot: {formatRelativeTime(endpoint.snapshotAge)}
          </span>
        </div>
      )}

      {/* View stacks link */}
      {onViewStacks && endpoint.stackCount > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onViewStacks(); }}
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          data-testid="view-stacks-link"
        >
          View {endpoint.stackCount} stack{endpoint.stackCount !== 1 ? 's' : ''}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </button>
  );
}

function StackCard({ stack, onClick }: { stack: StackWithEndpoint; onClick: () => void }) {
  const isInferred = stack.source === 'compose-label';

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border bg-card p-4 shadow-sm text-left text-sm transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {/* Row 1: Name + ID/Discovered — matches table Name column */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-medium">{stack.name}</h3>
        {isInferred ? <DiscoveredBadge /> : <span className="shrink-0 text-xs text-muted-foreground">(ID: {stack.id})</span>}
      </div>

      {/* Row 2: Stack type + Status badge — matches table Type + Status columns */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {getStackType(stack.type)}
        </span>
        <StatusBadge status={stack.status} />
      </div>

      {/* Row 3: Inline stats — matches table Endpoint + Details columns */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {stack.endpointName}
          <span className="ml-1">(ID: {stack.endpointId})</span>
        </span>
        <span>{isInferred ? `${stack.containerCount ?? 0} containers` : `${stack.envCount} env vars`}</span>
      </div>
    </button>
  );
}

export default function InfrastructurePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setPageViewMode = useUiStore((s) => s.setPageViewMode);

  // --- URL-driven tab state ---
  const activeTab = resolveTab(searchParams.get('tab'));

  const handleTabChange = useCallback((newTab: string) => {
    const resolved = resolveTab(newTab);
    const params: Record<string, string> = { tab: resolved };
    // Preserve existing filter params when switching tabs
    const endpointStatus = searchParams.get('endpointStatus');
    const endpointType = searchParams.get('endpointType');
    const stackStatus = searchParams.get('stackStatus');
    const stackEndpoint = searchParams.get('stackEndpoint');
    if (endpointStatus) params.endpointStatus = endpointStatus;
    if (endpointType) params.endpointType = endpointType;
    if (stackStatus) params.stackStatus = stackStatus;
    if (stackEndpoint) params.stackEndpoint = stackEndpoint;
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  // --- URL-persisted filter state ---
  const endpointStatusFilter = searchParams.get('endpointStatus') ?? ALL_FILTER;
  const endpointTypeFilter = searchParams.get('endpointType') ?? ALL_FILTER;
  const stackStatusFilter = searchParams.get('stackStatus') ?? ALL_FILTER;
  const stackEndpointFilterParam = searchParams.get('stackEndpoint') ?? ALL_FILTER;

  const setFleetFilters = useCallback((
    epStatus: string,
    epType: string,
    sStatus: string,
    sEndpoint: string,
  ) => {
    const currentTab = searchParams.get('tab');
    const params: Record<string, string> = {};
    if (currentTab) params.tab = currentTab;
    if (epStatus !== ALL_FILTER) params.endpointStatus = epStatus;
    if (epType !== ALL_FILTER) params.endpointType = epType;
    if (sStatus !== ALL_FILTER) params.stackStatus = sStatus;
    if (sEndpoint !== ALL_FILTER) params.stackEndpoint = sEndpoint;
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const setEndpointStatusFilter = useCallback((v: string) => {
    setFleetFilters(v, endpointTypeFilter, stackStatusFilter, stackEndpointFilterParam);
  }, [setFleetFilters, endpointTypeFilter, stackStatusFilter, stackEndpointFilterParam]);

  const setEndpointTypeFilter = useCallback((v: string) => {
    setFleetFilters(endpointStatusFilter, v, stackStatusFilter, stackEndpointFilterParam);
  }, [setFleetFilters, endpointStatusFilter, stackStatusFilter, stackEndpointFilterParam]);

  const setStackStatusFilter = useCallback((v: string) => {
    setFleetFilters(endpointStatusFilter, endpointTypeFilter, v, stackEndpointFilterParam);
  }, [setFleetFilters, endpointStatusFilter, endpointTypeFilter, stackEndpointFilterParam]);

  const setStackEndpointFilter = useCallback((v: string) => {
    setFleetFilters(endpointStatusFilter, endpointTypeFilter, stackStatusFilter, v);
  }, [setFleetFilters, endpointStatusFilter, endpointTypeFilter, stackStatusFilter]);

  // Summary-bar pill handlers: translate undefined ↔ ALL_FILTER for URL params
  const handleEndpointStatusPillChange = useCallback((status: string | undefined) => {
    setEndpointStatusFilter(status ?? ALL_FILTER);
  }, [setEndpointStatusFilter]);

  const handleStackStatusPillChange = useCallback((status: string | undefined) => {
    setStackStatusFilter(status ?? ALL_FILTER);
  }, [setStackStatusFilter]);

  // Derive pill-style filter value (undefined = no filter) from URL params
  const activeEndpointStatusPill = endpointStatusFilter !== ALL_FILTER ? endpointStatusFilter : undefined;
  const activeStackStatusPill = stackStatusFilter !== ALL_FILTER ? stackStatusFilter : undefined;

  // Fleet view mode (reuses existing 'fleet' key for preference persistence)
  const storedFleetViewMode = useUiStore((s) => s.pageViewModes['fleet']);
  const fleetViewMode = storedFleetViewMode ?? 'grid';
  const setFleetViewMode = (mode: 'grid' | 'table') => setPageViewMode('fleet', mode);
  const [gridPage, setGridPage] = useState(1);

  // Stacks view mode
  const stacksViewMode = useUiStore((s) => s.pageViewModes['stacks'] ?? 'grid');
  const setStacksViewMode = (mode: 'grid' | 'table') => setPageViewMode('stacks', mode);

  // Search state
  const [endpointSearchQuery, setEndpointSearchQuery] = useState('');
  const [stackSearchQuery, setStackSearchQuery] = useState('');

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

  // Kubernetes data
  const {
    data: k8sPods,
    isLoading: k8sPodsLoading,
    refetch: refetchK8sPods,
    isFetching: k8sPodsFetching,
  } = useK8sPods();
  const {
    data: k8sDeployments,
    isLoading: k8sDeploymentsLoading,
  } = useK8sDeployments();
  const {
    data: k8sServices,
    isLoading: k8sServicesLoading,
  } = useK8sServices();
  const {
    data: k8sNamespaces,
  } = useK8sNamespaces();

  const isLoading = endpointsLoading || stacksLoading;
  const isFetching = endpointsFetching || stacksFetching;

  // Shared auto-refresh preference
  const { interval, setInterval } = useAutoRefresh(30);

  // Cross-section filter: "View stacks" link sets stackEndpoint filter AND switches to stacks tab
  const handleViewStacks = useCallback((endpointId: number) => {
    const params: Record<string, string> = { tab: 'stacks', stackEndpoint: String(endpointId) };
    // Preserve current endpoint filters
    if (endpointStatusFilter !== ALL_FILTER) params.endpointStatus = endpointStatusFilter;
    if (endpointTypeFilter !== ALL_FILTER) params.endpointType = endpointTypeFilter;
    if (stackStatusFilter !== ALL_FILTER) params.stackStatus = stackStatusFilter;
    setSearchParams(params, { replace: true });
  }, [setSearchParams, endpointStatusFilter, endpointTypeFilter, stackStatusFilter]);

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

  // --- Endpoint filtering (dropdown filters, then smart search) ---
  const dropdownFilteredEndpoints = useMemo(() => {
    if (!endpoints) return [];
    return endpoints.filter(ep => {
      if (endpointStatusFilter !== ALL_FILTER && ep.status !== endpointStatusFilter) return false;
      if (endpointTypeFilter !== ALL_FILTER && String(ep.type) !== endpointTypeFilter) return false;
      return true;
    });
  }, [endpoints, endpointStatusFilter, endpointTypeFilter]);

  // Dynamic filter options for endpoints (computed from unfiltered data, with counts)
  const endpointStatusOptions = useMemo(() => {
    if (!endpoints) return [];
    const upCount = endpoints.filter(ep => ep.status === 'up').length;
    const downCount = endpoints.filter(ep => ep.status === 'down').length;
    const options = [{ value: ALL_FILTER, label: `All statuses (${endpoints.length})` }];
    if (upCount > 0) options.push({ value: 'up', label: `Up (${upCount})` });
    if (downCount > 0) options.push({ value: 'down', label: `Down (${downCount})` });
    return options;
  }, [endpoints]);

  const endpointTypeOptions = useMemo(() => {
    if (!endpoints) return [];
    const typeCounts = new Map<number, number>();
    for (const ep of endpoints) {
      typeCounts.set(ep.type, (typeCounts.get(ep.type) ?? 0) + 1);
    }
    // Only show environment type filter if there are multiple types
    if (typeCounts.size <= 1) return [];
    const options = [{ value: ALL_FILTER, label: `All types (${endpoints.length})` }];
    for (const [type, count] of [...typeCounts.entries()].sort((a, b) => a[0] - b[0])) {
      options.push({ value: String(type), label: `${getEndpointTypeLabel(type)} (${count})` });
    }
    return options;
  }, [endpoints]);

  // Enrich stacks with endpoint names using the shared endpoints data
  const stacksWithEndpoints = useMemo<StackWithEndpoint[]>(() => {
    if (!stacks || !endpoints) return [];
    return stacks.map(stack => ({
      ...stack,
      endpointName: endpoints.find(ep => ep.id === stack.endpointId)?.name || `Endpoint ${stack.endpointId}`,
    }));
  }, [stacks, endpoints]);

  // Search-filtered endpoints (dropdown filters applied upstream, then smart search)
  const filteredEndpoints = useMemo(
    () => dropdownFilteredEndpoints ? filterEndpoints(dropdownFilteredEndpoints, endpointSearchQuery) : [],
    [dropdownFilteredEndpoints, endpointSearchQuery],
  );

  // Reset grid page when filtered endpoint list changes
  useEffect(() => {
    setGridPage(1);
  }, [filteredEndpoints.length]);

  // --- Stack filtering (dropdown filters, then smart search) ---
  const dropdownFilteredStacks = useMemo(() => {
    return stacksWithEndpoints.filter(s => {
      if (stackStatusFilter !== ALL_FILTER && s.status !== stackStatusFilter) return false;
      if (stackEndpointFilterParam !== ALL_FILTER && String(s.endpointId) !== stackEndpointFilterParam) return false;
      return true;
    });
  }, [stacksWithEndpoints, stackStatusFilter, stackEndpointFilterParam]);

  const filteredStacks = useMemo(
    () => filterStacks(dropdownFilteredStacks, stackSearchQuery),
    [dropdownFilteredStacks, stackSearchQuery],
  );

  // Dynamic filter options for stacks
  const stackStatusOptions = useMemo(() => {
    if (stacksWithEndpoints.length === 0) return [];
    const activeCount = stacksWithEndpoints.filter(s => s.status === 'active').length;
    const inactiveCount = stacksWithEndpoints.filter(s => s.status === 'inactive').length;
    const options = [{ value: ALL_FILTER, label: `All statuses (${stacksWithEndpoints.length})` }];
    if (activeCount > 0) options.push({ value: 'active', label: `Active (${activeCount})` });
    if (inactiveCount > 0) options.push({ value: 'inactive', label: `Inactive (${inactiveCount})` });
    return options;
  }, [stacksWithEndpoints]);

  const stackEndpointOptions = useMemo(() => {
    if (stacksWithEndpoints.length === 0 || !endpoints) return [];
    // Only endpoints that actually have stacks
    const endpointIds = new Set(stacksWithEndpoints.map(s => s.endpointId));
    if (endpointIds.size <= 1) return [];
    const options = [{ value: ALL_FILTER, label: `All endpoints (${stacksWithEndpoints.length})` }];
    for (const epId of [...endpointIds].sort((a, b) => a - b)) {
      const epName = endpoints.find(ep => ep.id === epId)?.name ?? `Endpoint ${epId}`;
      const count = stacksWithEndpoints.filter(s => s.endpointId === epId).length;
      options.push({ value: String(epId), label: `${epName} (${count})` });
    }
    return options;
  }, [stacksWithEndpoints, endpoints]);

  // Fleet grid pagination (on filtered data)
  const gridPageCount = Math.ceil(filteredEndpoints.length / FLEET_GRID_PAGE_SIZE);
  const paginatedEndpoints = useMemo(() => {
    const start = (gridPage - 1) * FLEET_GRID_PAGE_SIZE;
    return filteredEndpoints.slice(start, start + FLEET_GRID_PAGE_SIZE);
  }, [filteredEndpoints, gridPage]);

  const handleEndpointSearch = useCallback((query: string) => {
    setEndpointSearchQuery(query);
    setGridPage(1);
  }, []);

  const handleEndpointClick = (endpointId: number) => {
    navigate(`/workloads?endpoint=${endpointId}`);
  };

  const handleStackClick = (stack: StackWithEndpoint) => {
    navigate(`/workloads?endpoint=${stack.endpointId}&stack=${encodeURIComponent(stack.name)}`);
  };

  // Whether any stack filter is active (for showing "filtered" state)
  const hasActiveStackFilter = stackStatusFilter !== ALL_FILTER || stackEndpointFilterParam !== ALL_FILTER;
  const hasActiveEndpointFilter = endpointStatusFilter !== ALL_FILTER || endpointTypeFilter !== ALL_FILTER;

  // Active filter chip arrays for each section
  const activeEndpointFilters = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    if (endpointStatusFilter !== ALL_FILTER) {
      chips.push({
        key: 'endpointStatus',
        label: 'Status',
        value: endpointStatusFilter.charAt(0).toUpperCase() + endpointStatusFilter.slice(1),
      });
    }
    if (endpointTypeFilter !== ALL_FILTER) {
      chips.push({
        key: 'endpointType',
        label: 'Type',
        value: getEndpointTypeLabel(Number(endpointTypeFilter)),
      });
    }
    return chips;
  }, [endpointStatusFilter, endpointTypeFilter]);

  const activeStackFilters = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    if (stackStatusFilter !== ALL_FILTER) {
      chips.push({
        key: 'stackStatus',
        label: 'Status',
        value: stackStatusFilter.charAt(0).toUpperCase() + stackStatusFilter.slice(1),
      });
    }
    if (stackEndpointFilterParam !== ALL_FILTER) {
      const epName = endpoints?.find(ep => ep.id === Number(stackEndpointFilterParam))?.name ?? `Endpoint ${stackEndpointFilterParam}`;
      chips.push({
        key: 'stackEndpoint',
        label: 'Endpoint',
        value: epName,
      });
    }
    return chips;
  }, [stackStatusFilter, stackEndpointFilterParam, endpoints]);

  const handleRemoveEndpointFilter = useCallback((key: string) => {
    if (key === 'endpointStatus') {
      setEndpointStatusFilter(ALL_FILTER);
    } else if (key === 'endpointType') {
      setEndpointTypeFilter(ALL_FILTER);
    }
  }, [setEndpointStatusFilter, setEndpointTypeFilter]);

  const handleClearAllEndpointFilters = useCallback(() => {
    setFleetFilters(ALL_FILTER, ALL_FILTER, stackStatusFilter, stackEndpointFilterParam);
  }, [setFleetFilters, stackStatusFilter, stackEndpointFilterParam]);

  const handleRemoveStackFilter = useCallback((key: string) => {
    if (key === 'stackStatus') {
      setStackStatusFilter(ALL_FILTER);
    } else if (key === 'stackEndpoint') {
      setStackEndpointFilter(ALL_FILTER);
    }
  }, [setStackStatusFilter, setStackEndpointFilter]);

  const handleClearAllStackFilters = useCallback(() => {
    setFleetFilters(endpointStatusFilter, endpointTypeFilter, ALL_FILTER, ALL_FILTER);
  }, [setFleetFilters, endpointStatusFilter, endpointTypeFilter]);

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

  // ── Kubernetes column definitions ───────────────────────────────────────────
  const k8sPodColumns: ColumnDef<K8sPod, unknown>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{row.original.namespace}</span>
        </div>
      ),
    },
    {
      accessorKey: 'state',
      header: 'State',
      cell: ({ row }) => <StatusBadge status={row.original.state === 'running' ? 'healthy' : row.original.state === 'pending' ? 'warning' : row.original.state === 'failed' ? 'error' : row.original.state} />,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
    },
    {
      id: 'ready',
      header: 'Ready',
      cell: ({ row }) => `${row.original.containers.filter((c) => c.ready).length}/${row.original.containers.length}`,
    },
    {
      accessorKey: 'restarts',
      header: 'Restarts',
    },
    {
      accessorKey: 'nodeName',
      header: 'Node',
      cell: ({ getValue }) => <span className="text-xs">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'endpointName',
      header: 'Cluster',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
    },
  ], []);

  const k8sDeploymentColumns: ColumnDef<K8sDeployment, unknown>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{row.original.namespace}</span>
        </div>
      ),
    },
    {
      id: 'ready',
      header: 'Ready',
      cell: ({ row }) => `${row.original.readyReplicas ?? 0}/${row.original.replicas}`,
    },
    {
      id: 'upToDate',
      header: 'Up-to-date',
      cell: ({ row }) => row.original.updatedReplicas ?? 0,
    },
    {
      id: 'available',
      header: 'Available',
      cell: ({ row }) => row.original.availableReplicas ?? 0,
    },
    {
      accessorKey: 'endpointName',
      header: 'Cluster',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
    },
  ], []);

  const k8sServiceColumns: ColumnDef<K8sService, unknown>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{row.original.namespace}</span>
        </div>
      ),
    },
    {
      accessorKey: 'serviceType',
      header: 'Type',
    },
    {
      accessorKey: 'clusterIP',
      header: 'Cluster IP',
      cell: ({ getValue }) => <span className="text-xs font-mono">{getValue<string>()}</span>,
    },
    {
      id: 'ports',
      header: 'Ports',
      cell: ({ row }) => (
        <span className="text-xs font-mono">
          {row.original.ports.map((p) => `${p.port}/${p.protocol}`).join(', ')}
        </span>
      ),
    },
    {
      accessorKey: 'endpointName',
      header: 'Cluster',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
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
          <RefreshControls
            interval={interval}
            onIntervalChange={setInterval}
            onRefresh={handleRefresh}
            onForceRefresh={forceRefresh}
            isLoading={isFetching || isForceRefreshing}
          />
        </div>
      </div>

      {/* Interactive status summary bar */}
      {!isLoading && (
        <SpotlightCard>
          <FleetStatusSummary
            endpoints={endpoints ?? []}
            stacks={stacksWithEndpoints}
            activeEndpointStatusFilter={activeEndpointStatusPill}
            onEndpointStatusChange={handleEndpointStatusPillChange}
            activeStackStatusFilter={activeStackStatusPill}
            onStackStatusChange={handleStackStatusPillChange}
          />
        </SpotlightCard>
      )}

      {/* Error state */}
      {hasError && (
        <>
          <EmptyState
            variant="error"
            icon={AlertTriangle}
            title="Failed to load infrastructure data"
            description={errorMessage}
          />
          <button
            onClick={handleRefresh}
            className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </>
      )}

      {/* Tabbed sections */}
      <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
        <Tabs.List className="flex gap-1 border-b" aria-label="Infrastructure sections">
          <Tabs.Trigger value="fleet" className={TAB_TRIGGER_CLASS} data-testid="tab-fleet">
            <Server className="h-4 w-4" />
            Fleet Overview
          </Tabs.Trigger>
          <Tabs.Trigger value="stacks" className={TAB_TRIGGER_CLASS} data-testid="tab-stacks">
            <Layers className="h-4 w-4" />
            Stack Overview
          </Tabs.Trigger>
          <Tabs.Trigger value="kubernetes" className={TAB_TRIGGER_CLASS} data-testid="tab-kubernetes">
            <Box className="h-4 w-4" />
            Kubernetes
            {k8sPods && k8sPods.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                {k8sPods.length}
              </span>
            )}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="fleet" className="mt-4">
      <section aria-labelledby="fleet-heading" className="space-y-4">
        <h2 id="fleet-heading" className="sr-only">Fleet Overview</h2>
        {!isLoading && endpoints != null && (
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
            {endpoints.length > 0 && (
              <div className="lg:flex-1">
                <FleetSearch
                  onSearch={handleEndpointSearch}
                  totalCount={endpoints.length}
                  filteredCount={filteredEndpoints.length}
                  placeholder="Search endpoints... (name:prod status:up type:edge)"
                  label="Search endpoints"
                  examples={['name:prod', 'status:up', 'type:edge']}
                  // Focus the search when the Fleet tab (the default landing tab) mounts,
                  // mirroring the Workload Explorer open-on-page autofocus.
                  autoFocus
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {/* Endpoint status filter */}
              {endpointStatusOptions.length > 2 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="endpoint-status-filter" className="text-xs text-muted-foreground">Status</label>
                  <ThemedSelect
                    id="endpoint-status-filter"
                    value={endpointStatusFilter}
                    onValueChange={setEndpointStatusFilter}
                    options={endpointStatusOptions}
                    className="w-[150px]"
                  />
                </div>
              )}
              {/* Endpoint type filter (only if multiple types) */}
              {endpointTypeOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="endpoint-type-filter" className="text-xs text-muted-foreground">Type</label>
                  <ThemedSelect
                    id="endpoint-type-filter"
                    value={endpointTypeFilter}
                    onValueChange={setEndpointTypeFilter}
                    options={endpointTypeOptions}
                    className="w-[170px]"
                  />
                </div>
              )}
              <span className="text-sm text-muted-foreground" data-testid="fleet-filtered-count">
                {filteredEndpoints.length}{filteredEndpoints.length !== (endpoints?.length ?? 0) ? ` of ${endpoints?.length}` : ''} endpoint{filteredEndpoints.length !== 1 ? 's' : ''}
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
          </div>
        )}

        {/* Endpoint filter chips */}
        {!isLoading && hasActiveEndpointFilter && (
          <FilterChipBar
            filters={activeEndpointFilters}
            onRemove={handleRemoveEndpointFilter}
            onClearAll={handleClearAllEndpointFilters}
          />
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonText key={i} lines={2} />
            ))}
          </div>
        ) : filteredEndpoints.length === 0 && endpoints && endpoints.length > 0 ? (
          <EmptyState
            icon={Server}
            title="No endpoints match filters"
            description="Adjust your filters to see endpoints."
          />
        ) : fleetViewMode === 'grid' ? (
          <>
            {paginatedEndpoints.length === 0 && endpointSearchQuery ? (
              <EmptyState
                icon={Search}
                title="No endpoints match your search"
                description="Try a different query or clear the search."
              />
            ) : (
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
            )}
            {gridPageCount > 1 && (
              <div className="flex items-center justify-between" data-testid="grid-pagination">
                <p className="text-sm text-muted-foreground">
                  Page {gridPage} of {gridPageCount} ({filteredEndpoints.length} endpoints)
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
        ) : fleetViewMode === 'table' ? (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <DataTable
              columns={endpointColumns}
              data={filteredEndpoints}
              hideSearch
              autoFit
              onRowClick={(row) => handleEndpointClick(row.id)}
            />
          </div>
          </SpotlightCard>
        ) : null}
      </section>
        </Tabs.Content>

        <Tabs.Content value="stacks" className="mt-4">
      <section aria-labelledby="stacks-heading" className="space-y-4">
        <h2 id="stacks-heading" className="sr-only">Stack Overview</h2>
        <div className="flex items-center gap-2">
          {stackEndpointFilterParam !== ALL_FILTER && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {endpoints?.find(ep => ep.id === Number(stackEndpointFilterParam))?.name ?? `Endpoint ${stackEndpointFilterParam}`}
              <button
                onClick={() => setStackEndpointFilter(ALL_FILTER)}
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
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
            {dropdownFilteredStacks.length > 0 && (
              <div className="lg:flex-1">
                <FleetSearch
                  onSearch={setStackSearchQuery}
                  totalCount={dropdownFilteredStacks.length}
                  filteredCount={filteredStacks.length}
                  placeholder="Search stacks... (name:traefik status:active endpoint:prod)"
                  label="Search stacks"
                  examples={['name:traefik', 'status:active', 'endpoint:prod']}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {/* Stack status filter */}
              {stackStatusOptions.length > 2 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="stack-status-filter" className="text-xs text-muted-foreground">Status</label>
                  <ThemedSelect
                    id="stack-status-filter"
                    value={stackStatusFilter}
                    onValueChange={setStackStatusFilter}
                    options={stackStatusOptions}
                    className="w-[160px]"
                  />
                </div>
              )}
              {/* Stack endpoint filter (only if multiple endpoints have stacks) */}
              {stackEndpointOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="stack-endpoint-filter" className="text-xs text-muted-foreground">Endpoint</label>
                  <ThemedSelect
                    id="stack-endpoint-filter"
                    value={stackEndpointFilterParam}
                    onValueChange={setStackEndpointFilter}
                    options={stackEndpointOptions}
                    className="w-[180px]"
                  />
                </div>
              )}
              <span className="text-sm text-muted-foreground" data-testid="stacks-filtered-count">
                {filteredStacks.length}{hasActiveStackFilter ? ` of ${stacksWithEndpoints.length}` : ''} stack{filteredStacks.length !== 1 ? 's' : ''}
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
          </div>
        )}

        {/* Stack filter chips */}
        {!isLoading && hasActiveStackFilter && (
          <FilterChipBar
            filters={activeStackFilters}
            onRemove={handleRemoveStackFilter}
            onClearAll={handleClearAllStackFilters}
          />
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonText key={i} lines={1} />
            ))}
          </div>
        ) : filteredStacks.length === 0 ? (
          <>
            {stackSearchQuery ? (
              <EmptyState icon={Search} title="No stacks match your search" description="Try a different query or clear the search." />
            ) : hasActiveStackFilter ? (
              <>
                <EmptyState
                  icon={Layers}
                  title="No stacks match filters"
                  description={
                    stackEndpointFilterParam !== ALL_FILTER
                      ? 'The selected endpoint has no Docker Stacks or Compose projects'
                      : 'Adjust your filters to see stacks'
                  }
                />
                <button
                  onClick={() => {
                    setFleetFilters(endpointStatusFilter, endpointTypeFilter, ALL_FILTER, ALL_FILTER);
                  }}
                  className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  Show all stacks
                </button>
              </>
            ) : (
              <EmptyState
                variant="not-configured"
                icon={Layers}
                title="No stacks or compose projects detected"
                description="There are no Docker Stacks or Compose projects deployed across your endpoints."
              />
            )}
          </>
        ) : stacksViewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStacks.map((stack) => (
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
              data={filteredStacks}
              hideSearch
              autoFit
              onRowClick={handleStackClick}
            />
          </div>
          </SpotlightCard>
        )}
      </section>
        </Tabs.Content>

        <Tabs.Content value="kubernetes" className="mt-4">
      <section aria-labelledby="k8s-heading" className="space-y-4">
        <h2 id="k8s-heading" className="sr-only">Kubernetes Resources</h2>

        {/* K8s summary bar */}
        <SpotlightCard>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-6 shadow-sm text-sm">
          <span className="font-medium">Kubernetes</span>
          <span className="text-muted-foreground">
            {k8sPods?.length ?? 0} pods
          </span>
          <span className="text-muted-foreground">
            {k8sDeployments?.length ?? 0} deployments
          </span>
          <span className="text-muted-foreground">
            {k8sServices?.length ?? 0} services
          </span>
          <span className="text-muted-foreground">
            {k8sNamespaces?.length ?? 0} namespaces
          </span>
          <div className="ml-auto">
            <RefreshButton
              onClick={() => refetchK8sPods()}
              isLoading={k8sPodsFetching}
            />
          </div>
        </div>
        </SpotlightCard>

        {/* Pods table */}
        {k8sPodsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonChart key={i} size="md" />
            ))}
          </div>
        ) : (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold">Pods</h3>
            <DataTable
              columns={k8sPodColumns}
              data={k8sPods ?? []}
              searchKey="name"
              searchPlaceholder="Search pods..."
              pageSize={15}
            />
          </div>
          </SpotlightCard>
        )}

        {/* Deployments table */}
        {!k8sDeploymentsLoading && k8sDeployments && k8sDeployments.length > 0 && (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold">Deployments</h3>
            <DataTable
              columns={k8sDeploymentColumns}
              data={k8sDeployments}
              searchKey="name"
              searchPlaceholder="Search deployments..."
              pageSize={15}
            />
          </div>
          </SpotlightCard>
        )}

        {/* Services table */}
        {!k8sServicesLoading && k8sServices && k8sServices.length > 0 && (
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold">Services</h3>
            <DataTable
              columns={k8sServiceColumns}
              data={k8sServices}
              searchKey="name"
              searchPlaceholder="Search services..."
              pageSize={15}
            />
          </div>
          </SpotlightCard>
        )}
      </section>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
