import { useMemo, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Box, Boxes, Cog, Download, GitCompareArrows, X } from 'lucide-react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { useContainers, type Container } from '@/features/containers/hooks/use-containers';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useStacks } from '@/features/containers/hooks/use-stacks';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { DataTable } from '@/shared/components/tables/data-table';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { FavoriteButton } from '@/shared/components/ui/favorite-button';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
import { resolveContainerStackName } from '@/features/containers/lib/container-stack-grouping';
import { exportToCsv } from '@/shared/lib/csv-export';
import { getContainerGroup, getContainerGroupLabel, type ContainerGroup } from '@/features/containers/lib/system-container-grouping';
import { formatDate, getImageShortName, truncate, formatRelativeAge } from '@/shared/lib/utils';
import { transition } from '@/shared/lib/motion-tokens';
import { WorkloadSmartSearch } from '@/shared/components/forms/workload-smart-search';
import { SelectionActionBar } from '@/shared/components/layout/selection-action-bar';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { ContainerComparisonView } from '@/features/containers/components/container-comparison-view';

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
  const imageParam = searchParams.get('image');
  const selectedEndpoint = endpointParam ? Number(endpointParam) : undefined;
  const selectedStack = stackParam || undefined;
  const selectedGroup: ContainerGroup | undefined =
    groupParam === 'system' || groupParam === 'workload'
      ? groupParam
      : undefined;
  const selectedState = stateParam || undefined;
  const selectedImage = imageParam || undefined;

  // Compare-mode state from URL
  const compareMode = searchParams.get('mode') === 'compare';
  const compareContainerIds = useMemo(() => {
    const raw = searchParams.get('containers');
    if (!raw) return [] as Array<{ endpointId: number; containerId: string }>;
    return raw
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const [eIdStr, cId] = pair.split(':');
        const eId = Number(eIdStr);
        if (!cId || Number.isNaN(eId) || eId <= 0) return null;
        return { endpointId: eId, containerId: cId };
      })
      .filter((x): x is { endpointId: number; containerId: string } => x !== null);
  }, [searchParams]);
  const compareTab = (searchParams.get('tab') as 'metrics' | 'config' | 'summary' | null) ?? 'metrics';
  const compareRange = searchParams.get('range') ?? '1h';

  const setFilters = (
    endpointId: number | undefined,
    stackName: string | undefined,
    group: ContainerGroup | undefined,
    state?: string | undefined,
    image?: string | undefined
  ) => {
    const next = new URLSearchParams(searchParams);
    // Reset only the filter keys this function owns
    next.delete('endpoint');
    next.delete('stack');
    next.delete('group');
    next.delete('state');
    next.delete('image');
    if (endpointId !== undefined) next.set('endpoint', String(endpointId));
    if (stackName) next.set('stack', stackName);
    if (group) next.set('group', group);
    if (state) next.set('state', state);
    if (image) next.set('image', image);
    setSearchParams(next);
  };

  const setSelectedEndpoint = (endpointId: number | undefined) => {
    setFilters(endpointId, undefined, selectedGroup, selectedState, selectedImage);
  };

  const setSelectedStack = (stackName: string | undefined) => {
    setFilters(selectedEndpoint, stackName, selectedGroup, selectedState, selectedImage);
  };

  const setSelectedGroup = (group: ContainerGroup | undefined) => {
    setFilters(selectedEndpoint, selectedStack, group, selectedState, selectedImage);
  };

  const setSelectedState = (state: string | undefined) => {
    setFilters(selectedEndpoint, selectedStack, selectedGroup, state, selectedImage);
  };

  const setSelectedImage = (image: string | undefined) => {
    setFilters(selectedEndpoint, selectedStack, selectedGroup, selectedState, image);
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
      const imageMatches = !selectedImage || container.image === selectedImage;
      return stackMatches && groupMatches && imageMatches;
    });
  }, [containers, selectedStack, selectedGroup, selectedImage, knownStackNames]);

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
    if (selectedState) {
      filters.push({
        key: 'state',
        label: 'State',
        value: selectedState.charAt(0).toUpperCase() + selectedState.slice(1),
        onRemove: () => {
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('state');
          navigate({ search: newParams.toString() });
        },
      });
    }
    if (selectedImage) {
      filters.push({
        key: 'image',
        label: 'Image',
        value: truncate(getImageShortName(selectedImage), 30),
        onRemove: () => setFilters(selectedEndpoint, selectedStack, selectedGroup, selectedState, undefined),
      });
    }
    return filters;
  }, [selectedEndpoint, selectedStack, selectedGroup, selectedState, selectedImage, endpoints]);

  const [selectedContainers, setSelectedContainers] = useState<Container[]>([]);
  const [controlledRowIds, setControlledRowIds] = useState<RowSelectionState | undefined>(undefined);

  const [searchFilteredContainers, setSearchFilteredContainers] = useState<Container[] | undefined>(undefined);

  // Reset search-filtered results when the upstream (dropdown) filters change
  useEffect(() => {
    setSearchFilteredContainers(undefined);
  }, [selectedEndpoint, selectedStack, selectedGroup, selectedState, selectedImage]);

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
      selectedImage
        ? `image-${getImageShortName(selectedImage).replace(/[^a-zA-Z0-9._-]+/g, '-')}`
        : 'all-images',
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
    const next = new URLSearchParams(searchParams);
    next.set('mode', 'compare');
    next.set('containers', param);
    setSearchParams(next, { replace: false });
  }, [selectedContainers, searchParams, setSearchParams]);

  // ── Compare-mode URL helpers ────────────────────────────────────────────

  const exitCompareMode = useCallback(() => {
    // Strip mode/containers/tab/range from the URL while keeping filter
    // params (endpoint/stack/group/state/q) intact.
    const next = new URLSearchParams(searchParams);
    next.delete('mode');
    next.delete('containers');
    next.delete('tab');
    next.delete('range');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const removeFromCompare = useCallback((target: { endpointId: number; containerId: string }) => {
    const remaining = compareContainerIds
      .filter((p) => !(p.containerId === target.containerId && p.endpointId === target.endpointId))
      .map((p) => `${p.endpointId}:${p.containerId}`)
      .join(',');
    const next = new URLSearchParams(searchParams);
    if (remaining) next.set('containers', remaining);
    else next.delete('containers');
    setSearchParams(next, { replace: false });
  }, [compareContainerIds, searchParams, setSearchParams]);

  const setCompareTab = useCallback((tab: 'metrics' | 'config' | 'summary') => {
    const next = new URLSearchParams(searchParams);
    // Only write to URL if non-default, to keep the URL clean.
    if (tab === 'metrics') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setCompareRange = useCallback((range: string) => {
    const next = new URLSearchParams(searchParams);
    if (range === '1h') next.delete('range');
    else next.set('range', range);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
              className="inline-flex items-center whitespace-nowrap rounded-lg bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/20 hover:shadow-sm hover:ring-1 hover:ring-primary/20"
            >
              {truncate(getValue<string>(), 45)}
            </button>
          </div>
        );
      },
    },
    {
      id: 'stack',
      header: 'Stackname',
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
            className="inline-flex items-center whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 transition-colors hover:bg-purple-200 hover:ring-1 hover:ring-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
            title={`Filter by stack: ${stackName}`}
          >
            {truncate(stackName, 25)}
          </button>
        );
      },
    },
    {
      accessorKey: 'state',
      header: 'State',
      cell: ({ getValue }) => {
        const state = getValue<string>();
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedState(state);
            }}
            className="rounded-full transition-all duration-200 hover:shadow-sm hover:ring-1 hover:ring-primary/30"
            title={`Filter by state: ${state}`}
          >
            <StatusBadge status={state} />
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedEndpoint(container.endpointId);
            }}
            className="inline-flex items-center whitespace-nowrap rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-200 hover:ring-1 hover:ring-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
            title={`Filter by endpoint: ${container.endpointName}`}
          >
            {container.endpointName}
          </button>
        );
      },
    },
    {
      accessorKey: 'image',
      header: 'Imagename',
      cell: ({ getValue }) => {
        const full = getValue<string>();
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedImage(full);
            }}
            className="inline-flex items-center whitespace-nowrap rounded-md bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground hover:ring-1 hover:ring-border"
            title={`Filter by image: ${full}`}
          >
            {truncate(getImageShortName(full), 50)}
          </button>
        );
      },
    },
    {
      id: 'group',
      header: 'Group',
      size: 72,
      cell: ({ row }) => {
        const container = row.original;
        const label = getContainerGroupLabel(container);
        const isSystem = label === 'System';
        const Icon = isSystem ? Cog : Box;
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedGroup(getContainerGroup(container));
            }}
            title={`Filter by group: ${label}`}
            aria-label={`Filter by ${label}`}
            className={
              isSystem
                ? 'inline-flex items-center justify-center rounded-md bg-amber-100 p-1 text-amber-900 transition-colors hover:bg-amber-200 hover:ring-1 hover:ring-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
                : 'inline-flex items-center justify-center rounded-md bg-slate-100 p-1 text-slate-700 transition-colors hover:bg-slate-200 hover:ring-1 hover:ring-slate-300 dark:bg-slate-900/30 dark:text-slate-300 dark:hover:bg-slate-900/50'
            }
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      },
    },
  ], [navigate, knownStackNames, selectedEndpoint, selectedStack, selectedGroup, selectedState, selectedImage]);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workload Explorer</h1>
          <p className="text-muted-foreground">
            Browse and manage containers across all endpoints
          </p>
        </div>
        <EmptyState
          variant="error"
          icon={AlertTriangle}
          title="Failed to load containers"
          description={error instanceof Error ? error.message : 'An unexpected error occurred'}
        />
        <button
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {compareMode ? (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={exitCompareMode}
                  className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  ← Back to list
                </button>
                <h1 className="text-3xl font-bold tracking-tight">
                  Comparing {compareContainerIds.length} container{compareContainerIds.length === 1 ? '' : 's'}
                </h1>
              </div>
              <p className="mt-1 text-muted-foreground">
                Compare metrics, configuration, and status across selected containers
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold tracking-tight">Workload Explorer</h1>
              <p className="text-muted-foreground">
                Browse and manage containers across all endpoints
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!compareMode && (
            <>
              <button
                type="button"
                onClick={handleCompare}
                disabled={selectedContainers.length < 2}
                title={selectedContainers.length < 2 ? 'Select 2 or more containers to compare' : `Compare ${selectedContainers.length} selected containers`}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background"
              >
                <GitCompareArrows className="h-4 w-4" />
                {selectedContainers.length < 2 ? 'Compare' : `Compare ${selectedContainers.length}`}
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={!exportRows.length}
                title={!exportRows.length ? 'Nothing to export' : 'Export the current view as CSV'}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </>
          )}
          <RefreshControls interval={interval} onIntervalChange={setInterval} onRefresh={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {compareMode ? (
        // ── Compare mode body ──
        <>
          {(() => {
            const compared = compareContainerIds
              .map(({ endpointId, containerId }) =>
                containers?.find((c) => c.id === containerId && c.endpointId === endpointId))
              .filter((c): c is Container => c !== undefined);

            if (isLoading) return <SkeletonChart size="md" />;

            if (compared.length < 2) {
              const heading = compared.length === 0
                ? 'No containers to compare'
                : 'Compare needs at least 2 containers';
              const body = compared.length === 0
                ? 'Pick at least 2 containers from Workload Explorer to compare them.'
                : 'Add another container from Workload Explorer to compare.';
              return (
                <>
                  <EmptyState
                    icon={Boxes}
                    title={heading}
                    description={body}
                  />
                  <button
                    type="button"
                    onClick={exitCompareMode}
                    className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    ← Back to list
                  </button>
                </>
              );
            }

            return (
              <ContainerComparisonView
                containers={compared}
                tab={compareTab}
                onTabChange={setCompareTab}
                timeRange={compareRange}
                onTimeRangeChange={setCompareRange}
                onRemove={removeFromCompare}
              />
            );
          })()}
        </>
      ) : (
        // ── Original table / filter pane / selection-action-bar block ──
        <>
          {/* Merged filter + table pane: search → dropdowns → chips → table */}
          {isLoading ? (
            <SkeletonChart size="lg" />
          ) : filteredContainers ? (
            <SpotlightCard>
            <div
              data-testid="workload-pane"
              className="rounded-lg border bg-card p-4 shadow-sm space-y-4"
            >
              {/* Smart search */}
              <WorkloadSmartSearch
                containers={filteredContainers}
                knownStackNames={knownStackNames}
                onFiltered={setSearchFilteredContainers}
                totalCount={filteredContainers.length}
                autoFocus
              />

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

              </div>

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

              <DataTable
                columns={columns}
                data={searchFilteredContainers ?? filteredContainers}
                hideSearch
                autoFit
                minTableWidth={770}
                enableRowSelection
                maxSelection={MAX_COMPARE}
                onSelectionChange={handleSelectionChange}
                getRowId={(row) => `${row.endpointId}:${row.id}`}
                selectedRowIds={controlledRowIds}
                onRowClick={(row) => navigate(`/containers/${row.endpointId}/${row.id}`)}
              />
            </div>
            </SpotlightCard>
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
        </>
      )}
    </div>
  );
}
