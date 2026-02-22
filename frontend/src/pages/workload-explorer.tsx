import { useMemo, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Eye, GitCompareArrows, ScrollText, X } from 'lucide-react';
import { ThemedSelect } from '@/components/shared/themed-select';
import { useContainers, type Container } from '@/hooks/use-containers';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useStacks } from '@/hooks/use-stacks';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { FavoriteButton } from '@/components/shared/favorite-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { resolveContainerStackName } from '@/lib/container-stack-grouping';
import { exportToCsv } from '@/lib/csv-export';
import { getContainerGroup, getContainerGroupLabel, type ContainerGroup } from '@/lib/system-container-grouping';
import { formatDate, truncate, formatRelativeAge } from '@/lib/utils';
import { transition } from '@/lib/motion-tokens';
import { WorkloadSmartSearch } from '@/components/shared/workload-smart-search';
import { SelectionActionBar } from '@/components/shared/selection-action-bar';
import { WorkloadStatusSummary } from '@/components/workload/workload-status-summary';

const MAX_COMPARE = 4;

export default function WorkloadExplorerPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read endpoint, stack, group, and state from URL params
  const endpointParam = searchParams.get('endpoint');
  const stackParam = searchParams.get('stack');
  const groupParam = searchParams.get('group');
  const stateParam = searchParams.get('state');
  const selectedEndpoint = endpointParam ? Number(endpointParam) : undefined;
  const selectedStack = stackParam || undefined;
  const selectedGroup: ContainerGroup | undefined =
    groupParam === 'system' || groupParam === 'workload'
      ? groupParam
      : undefined;
  const selectedState = stateParam || undefined;

  const setFilters = (
    endpointId: number | undefined,
    stackName: string | undefined,
    group: ContainerGroup | undefined,
    state?: string | undefined
  ) => {
    const params: Record<string, string> = {};
    if (endpointId !== undefined) {
      params.endpoint = String(endpointId);
    }
    if (stackName) {
      params.stack = stackName;
    }
    if (group) {
      params.group = group;
    }
    if (state) {
      params.state = state;
    }
    setSearchParams(params);
  };

  const setSelectedEndpoint = (endpointId: number | undefined) => {
    setFilters(endpointId, undefined, selectedGroup, selectedState);
  };

  const setSelectedStack = (stackName: string | undefined) => {
    setFilters(selectedEndpoint, stackName, selectedGroup, selectedState);
  };

  const setSelectedGroup = (group: ContainerGroup | undefined) => {
    setFilters(selectedEndpoint, selectedStack, group, selectedState);
  };

  const setSelectedState = (state: string | undefined) => {
    setFilters(selectedEndpoint, selectedStack, selectedGroup, state);
  };

  const { data: endpoints } = useEndpoints();
  const { data: stacks } = useStacks();
  const { data: containers, isLoading, isError, error, refetch, isFetching } = useContainers(selectedEndpoint !== undefined ? { endpointId: selectedEndpoint } : undefined);
  const { forceRefresh, isForceRefreshing } = useForceRefresh('containers', refetch);
  const { interval, setInterval } = useAutoRefresh(30);

  const knownStackNames = useMemo(() => {
    if (!stacks) return [];
    return stacks
      .filter((stack) => selectedEndpoint === undefined || stack.endpointId === selectedEndpoint)
      .map((stack) => stack.name);
  }, [stacks, selectedEndpoint]);

  const availableStacks = useMemo(() => {
    if (!containers) return [];
    const stackNames = new Set<string>(knownStackNames);
    for (const container of containers) {
      const resolvedStack = resolveContainerStackName(container, knownStackNames);
      if (resolvedStack) {
        stackNames.add(resolvedStack);
      }
    }
    return [...stackNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  }, [containers, knownStackNames]);

  // Containers filtered by stack/group (before state filter, used for state counts)
  const preStateFilteredContainers = useMemo(() => {
    if (!containers) return [];
    return containers.filter((container) => {
      const stackMatches = !selectedStack || resolveContainerStackName(container, knownStackNames) === selectedStack;
      const groupMatches = !selectedGroup || getContainerGroup(container) === selectedGroup;
      return stackMatches && groupMatches;
    });
  }, [containers, selectedStack, selectedGroup, knownStackNames]);

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const container of preStateFilteredContainers) {
      counts[container.state] = (counts[container.state] || 0) + 1;
    }
    return counts;
  }, [preStateFilteredContainers]);

  // Apply state filter on top of stack/group filtering
  const filteredContainers = useMemo(() => {
    if (!selectedState) return preStateFilteredContainers;
    return preStateFilteredContainers.filter((container) => container.state === selectedState);
  }, [preStateFilteredContainers, selectedState]);

  const activeFilters = useMemo(() => {
    const filters: { key: string; label: string; value: string; onRemove: () => void }[] = [];
    if (selectedEndpoint !== undefined) {
      const ep = endpoints?.find(e => e.id === selectedEndpoint);
      filters.push({
        key: 'endpoint',
        label: 'Endpoint',
        value: ep ? `${ep.name} (ID: ${ep.id})` : `ID: ${selectedEndpoint}`,
        onRemove: () => setFilters(undefined, selectedStack, selectedGroup, selectedState),
      });
    }
    if (selectedStack) {
      filters.push({
        key: 'stack',
        label: 'Stack',
        value: selectedStack,
        onRemove: () => setFilters(selectedEndpoint, undefined, selectedGroup, selectedState),
      });
    }
    if (selectedGroup) {
      filters.push({
        key: 'group',
        label: 'Group',
        value: selectedGroup === 'system' ? 'System' : 'Workload',
        onRemove: () => setFilters(selectedEndpoint, selectedStack, undefined, selectedState),
      });
    }
    return filters;
  }, [selectedEndpoint, selectedStack, selectedGroup, selectedState, endpoints]);

  const [selectedContainers, setSelectedContainers] = useState<Container[]>([]);
  const [controlledRowIds, setControlledRowIds] = useState<RowSelectionState | undefined>(undefined);

  const [searchFilteredContainers, setSearchFilteredContainers] = useState<Container[] | undefined>(undefined);

  // Reset search-filtered results when the upstream (dropdown) filters change
  useEffect(() => {
    setSearchFilteredContainers(undefined);
  }, [selectedEndpoint, selectedStack, selectedGroup, selectedState]);

  const exportRows = useMemo<Record<string, unknown>[]>(() => {
    if (!filteredContainers) return [];
    return filteredContainers.map((container) => ({
      name: container.name,
      image: container.image,
      group: getContainerGroupLabel(container),
      stack: resolveContainerStackName(container, knownStackNames) ?? 'No Stack',
      state: container.state,
      status: container.status,
      endpoint: container.endpointName,
      age: formatRelativeAge(container.created),
      created: formatDate(new Date(container.created * 1000)),
    }));
  }, [filteredContainers, knownStackNames]);

  const handleExportCsv = () => {
    if (!exportRows.length) return;
    const scope = [
      selectedEndpoint !== undefined ? `endpoint-${selectedEndpoint}` : 'all-endpoints',
      selectedStack ?? 'all-stacks',
      selectedGroup ?? 'all-groups',
    ].join('-');
    const date = new Date().toISOString().slice(0, 10);
    exportToCsv(exportRows, `workload-explorer-${scope}-${date}.csv`);
  };

  const handleSelectionChange = useCallback((rows: Container[]) => {
    setSelectedContainers(rows);
    // Clear the controlled override so internal state takes over again
    setControlledRowIds(undefined);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedContainers([]);
    setControlledRowIds({});
  }, []);

  const handleCompare = useCallback(() => {
    if (selectedContainers.length < 2) return;
    const param = selectedContainers
      .map((c) => `${c.endpointId}:${c.id}`)
      .join(',');
    navigate(`/comparison?containers=${param}`);
  }, [selectedContainers, navigate]);

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
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/containers/${container.endpointId}/${container.id}`);
              }}
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
      id: 'group',
      header: 'Group',
      cell: ({ row }) => {
        const label = getContainerGroupLabel(row.original);
        const isSystem = label === 'System';
        return (
          <span
            className={
              isSystem
                ? 'inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-300'
                : 'inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-900/30 dark:text-slate-300'
            }
          >
            {label}
          </span>
        );
      },
    },
    {
      id: 'stack',
      header: 'Stack',
      size: 160,
      cell: ({ row }) => {
        const stackName = resolveContainerStackName(row.original, knownStackNames);
        if (!stackName) {
          return <span className="text-muted-foreground/50 text-xs">—</span>;
        }
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedStack(stackName);
            }}
            className="inline-flex items-center rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 transition-colors hover:bg-purple-200 hover:ring-1 hover:ring-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
            title={`Filter by stack: ${stackName}`}
          >
            {truncate(stackName, 25)}
          </button>
        );
      },
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
      id: 'age',
      header: 'Age',
      accessorKey: 'created',
      cell: ({ row }) => {
        const container = row.original;
        const age = formatRelativeAge(container.created);
        const absoluteDate = formatDate(new Date(container.created * 1000));
        const state = container.state;

        let prefix = '';
        let colorClass = 'text-muted-foreground';

        if (state === 'running') {
          colorClass = 'text-emerald-600 dark:text-emerald-400';
        } else if (state === 'exited' || state === 'stopped') {
          prefix = state === 'exited' ? 'Exited ' : 'Stopped ';
          colorClass = 'text-muted-foreground';
        } else if (state === 'paused') {
          prefix = 'Paused ';
          colorClass = 'text-amber-600 dark:text-amber-400';
        } else if (state === 'dead') {
          prefix = 'Dead ';
          colorClass = 'text-red-600 dark:text-red-400';
        }

        const display = state === 'running' ? age : `${prefix}${age} ago`;

        return (
          <span className={`text-xs ${colorClass}`} title={absoluteDate}>
            {display}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      size: 90,
      enableSorting: false,
      cell: ({ row }) => {
        const container = row.original;
        return (
          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 max-sm:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/containers/${container.endpointId}/${container.id}`);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
              aria-label={`View details for ${container.name}`}
              title="View details"
            >
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/containers/${container.endpointId}/${container.id}?tab=logs`);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
              aria-label={`View logs for ${container.name}`}
              title="View logs"
            >
              <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        );
      },
    },
  ], [navigate, knownStackNames]);

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
          <RefreshButton onClick={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {/* Filter pane: dropdowns + status summary */}
      <div className="rounded-xl border bg-card/50 backdrop-blur-sm p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor="endpoint-select" className="text-sm font-medium">
              Endpoint
            </label>
            <ThemedSelect
              id="endpoint-select"
              value={selectedEndpoint !== undefined ? String(selectedEndpoint) : '__all__'}
              onValueChange={(val) => setSelectedEndpoint(val === '__all__' ? undefined : Number(val))}
              options={[
                { value: '__all__', label: 'All endpoints' },
                ...(endpoints?.map((ep) => ({
                  value: String(ep.id),
                  label: `${ep.name} (ID: ${ep.id})`,
                })) ?? []),
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="stack-select" className="text-sm font-medium">
              Stack
            </label>
            <ThemedSelect
              id="stack-select"
              value={selectedStack ?? '__all__'}
              onValueChange={(value) => setSelectedStack(value === '__all__' ? undefined : value)}
              options={[
                { value: '__all__', label: 'All stacks' },
                ...availableStacks.map((stackName) => ({
                  value: stackName,
                  label: stackName,
                })),
              ]}
              disabled={!containers || availableStacks.length === 0}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="group-select" className="text-sm font-medium">
              Group
            </label>
            <ThemedSelect
              id="group-select"
              value={selectedGroup ?? '__all__'}
              onValueChange={(value) => setSelectedGroup(value === '__all__' ? undefined : (value as ContainerGroup))}
              options={[
                { value: '__all__', label: 'All groups' },
                { value: 'system', label: 'System' },
                { value: 'workload', label: 'Workload' },
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="state-select" className="text-sm font-medium">
              State
            </label>
            <ThemedSelect
              id="state-select"
              value={selectedState ?? '__all__'}
              onValueChange={(value) => setSelectedState(value === '__all__' ? undefined : value)}
              options={[
                { value: '__all__', label: 'All states' },
                ...['running', 'stopped', 'exited', 'paused', 'created', 'restarting', 'dead'].map((state) => ({
                  value: state,
                  label: `${state.charAt(0).toUpperCase() + state.slice(1)} (${stateCounts[state] || 0})`,
                })),
              ]}
            />
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!exportRows.length}
            className="inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>

        {preStateFilteredContainers.length > 0 && (
          <WorkloadStatusSummary
            containers={preStateFilteredContainers}
            activeStateFilter={selectedState}
            onStateFilterChange={setSelectedState}
          />
        )}
      </div>

      {/* Table pane: filter chips + search + table */}
      {isLoading ? (
        <SkeletonCard className="h-[500px]" />
      ) : filteredContainers ? (
        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap" aria-live="polite">
              <AnimatePresence mode="popLayout">
                {activeFilters.map((filter) => (
                  <motion.span
                    key={filter.key}
                    layout
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                    transition={reduceMotion ? { duration: 0 } : transition.fast}
                    className="inline-flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur-sm border border-border/50 px-3 py-1 text-sm shadow-sm"
                  >
                    <span className="font-medium text-muted-foreground">{filter.label}:</span>
                    <span>{filter.value}</span>
                    <button
                      type="button"
                      onClick={filter.onRemove}
                      className="ml-1 -mr-1 rounded-full p-0.5 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${filter.label} filter`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
              {activeFilters.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setFilters(undefined, undefined, undefined, undefined)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}

          {/* Smart search */}
          <WorkloadSmartSearch
            containers={filteredContainers}
            knownStackNames={knownStackNames}
            onFiltered={setSearchFilteredContainers}
            totalCount={filteredContainers.length}
          />

          <DataTable
            columns={columns}
            data={searchFilteredContainers ?? filteredContainers}
            hideSearch
            pageSize={15}
            enableRowSelection
            maxSelection={MAX_COMPARE}
            onSelectionChange={handleSelectionChange}
            getRowId={(row) => `${row.endpointId}:${row.id}`}
            selectedRowIds={controlledRowIds}
            onRowClick={(row) => navigate(`/containers/${row.endpointId}/${row.id}`)}
          />
        </div>
      ) : null}

      {/* Floating compare action bar */}
      <SelectionActionBar
        selectedCount={selectedContainers.length}
        visible={selectedContainers.length >= 2}
        onClear={handleClearSelection}
      >
        <button
          data-testid="compare-button"
          onClick={handleCompare}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <GitCompareArrows className="h-4 w-4" />
          Compare ({selectedContainers.length})
        </button>
      </SelectionActionBar>
    </div>
  );
}
