import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Container } from '@/features/containers/hooks/use-containers';

const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();
const mockExportToCsv = vi.fn();
let mockQueryString = 'endpoint=1&stack=workers';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(mockQueryString), mockSetSearchParams],
  useNavigate: () => mockNavigate,
}));

vi.mock('@/shared/lib/csv-export', () => ({
  exportToCsv: (...args: unknown[]) => mockExportToCsv(...args),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({
    data: [{ id: 1, name: 'local' }],
  }),
}));

vi.mock('@/features/containers/hooks/use-stacks', () => ({
  useStacks: () => ({
    data: [
      { id: 10, name: 'workers', endpointId: 1, type: 2, status: 'active', envCount: 0 },
      { id: 11, name: 'billing', endpointId: 1, type: 2, status: 'active', envCount: 0 },
    ],
  }),
}));

const defaultContainersMock = {
  data: [
    {
      id: 'c-workers',
      name: 'workers-api-1',
      image: 'workers:latest',
      state: 'running',
      status: 'Up',
      endpointId: 1,
      endpointName: 'local',
      ports: [],
      created: 1700000000,
      labels: { 'com.docker.compose.project': 'workers' },
      networks: [],
    },
    {
      id: 'c-beyla',
      name: 'beyla',
      image: 'grafana/beyla:latest',
      state: 'running',
      status: 'Up',
      endpointId: 1,
      endpointName: 'local',
      ports: [],
      created: 1700000000,
      labels: {},
      networks: [],
    },
    {
      id: 'c-billing',
      name: 'billing-api-1',
      image: 'billing:latest',
      state: 'running',
      status: 'Up',
      endpointId: 1,
      endpointName: 'local',
      ports: [],
      created: 1700000000,
      labels: { 'com.docker.compose.project': 'billing' },
      networks: [],
    },
  ] as Container[],
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  isFetching: false,
};

const mockUseContainers = vi.fn(() => defaultContainersMock);

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: (...args: unknown[]) => mockUseContainers(...args),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({
    interval: 30,
    setInterval: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({
    forceRefresh: vi.fn(),
    isForceRefreshing: false,
  }),
}));

vi.mock('@/shared/components/ui/themed-select', () => ({
  ThemedSelect: ({ id, value, options }: { id?: string; value: string; options: Array<{ value: string; label: string }> }) => (
    <div data-testid={id} data-value={value}>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}));

let mockOnSelectionChange: ((rows: Array<{ id: string; name: string; endpointId: number }>) => void) | undefined;
let mockColumns: any[] | undefined;

vi.mock('@/shared/components/tables/data-table', () => ({
  DataTable: ({
    columns,
    data,
    enableRowSelection,
    maxSelection,
    onSelectionChange,
    selectedRowIds,
    onRowClick,
  }: {
    columns?: any[];
    data: Array<{ name: string }>;
    enableRowSelection?: boolean;
    maxSelection?: number;
    onSelectionChange?: (rows: Array<{ id: string; name: string; endpointId: number }>) => void;
    selectedRowIds?: Record<string, boolean>;
    onRowClick?: (row: { id: string; name: string; endpointId: number }) => void;
  }) => {
    mockOnSelectionChange = onSelectionChange;
    mockColumns = columns;
    return (
      <div
        data-testid="workloads-table"
        data-enable-row-selection={enableRowSelection ? 'true' : undefined}
        data-max-selection={maxSelection}
        data-selected-row-ids={selectedRowIds !== undefined ? JSON.stringify(selectedRowIds) : undefined}
        data-has-row-click={onRowClick ? 'true' : undefined}
      >
        {data.map((container) => container.name).join(',')}
      </div>
    );
  },
}));

vi.mock('@/shared/components/feedback/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/shared/components/ui/auto-refresh-toggle', () => ({
  AutoRefreshToggle: () => <div>Auto Refresh</div>,
}));

vi.mock('@/shared/components/ui/refresh-button', () => ({
  RefreshButton: () => <button type="button">Refresh</button>,
}));

vi.mock('@/shared/components/ui/favorite-button', () => ({
  FavoriteButton: () => <button type="button">Favorite</button>,
}));

vi.mock('@/shared/components/feedback/loading-skeleton', () => ({
  SkeletonCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/shared/components/layout/selection-action-bar', () => ({
  SelectionActionBar: ({
    selectedCount,
    visible,
    onClear,
    children,
  }: {
    selectedCount: number;
    visible: boolean;
    onClear: () => void;
    children: ReactNode;
  }) =>
    visible ? (
      <div data-testid="selection-action-bar" data-count={selectedCount}>
        {children}
        <button data-testid="clear-selection" onClick={onClear}>Clear</button>
      </div>
    ) : null,
}));

vi.mock('@/shared/lib/motion-tokens', () => ({
  transition: { fast: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } },
}));

let mockOnRemoveFromComparison: ((target: { endpointId: number; containerId: string }) => void) | undefined;

vi.mock('@/features/containers/components/container-comparison-view', () => ({
  ContainerComparisonView: ({
    containers,
    tab,
    onRemove,
  }: {
    containers: Array<{ id: string; name: string; endpointId: number }>;
    tab: string;
    onRemove: (target: { endpointId: number; containerId: string }) => void;
  }) => {
    mockOnRemoveFromComparison = onRemove;
    return (
      <div data-testid="container-comparison-view" data-tab={tab} data-container-count={containers.length}>
        {tab === 'metrics' && (
          <>
            <h3>CPU Usage</h3>
            <h3>Memory Usage</h3>
          </>
        )}
        {containers.map((c) => (
          <button
            key={c.id}
            aria-label={`Remove ${c.name} from comparison`}
            onClick={() => onRemove({ endpointId: c.endpointId, containerId: c.id })}
          >
            {c.name}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    span: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => <span {...Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'layout'].includes(k)))}>{children}</span>,
  },
  useReducedMotion: () => false,
}));

let mockOnFiltered: ((containers: unknown[]) => void) | undefined;

vi.mock('@/shared/components/forms/workload-smart-search', () => ({
  WorkloadSmartSearch: ({ onFiltered, totalCount }: { onFiltered: (c: unknown[]) => void; totalCount: number }) => {
    mockOnFiltered = onFiltered;
    return <div data-testid="workload-smart-search" data-total={totalCount} />;
  },
}));

let mockOnStateFilterChange: ((state: string | undefined) => void) | undefined;

vi.mock('@/features/containers/components/workload/workload-status-summary', () => ({
  WorkloadStatusSummary: ({ containers, activeStateFilter, onStateFilterChange }: { containers: unknown[]; activeStateFilter: string | undefined; onStateFilterChange: (s: string | undefined) => void }) => {
    mockOnStateFilterChange = onStateFilterChange;
    return <div data-testid="workload-status-summary" data-count={containers.length} data-active={activeStateFilter ?? ''} />;
  },
}));

import WorkloadExplorerPage from './workload-explorer';

describe('WorkloadExplorerPage', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1&stack=workers';
    mockSetSearchParams.mockReset();
    mockExportToCsv.mockReset();
    mockNavigate.mockReset();
    mockOnFiltered = undefined;
    mockOnSelectionChange = undefined;
    mockOnStateFilterChange = undefined;
    mockColumns = undefined;
    mockUseContainers.mockReturnValue(defaultContainersMock);
  });

  it('renders stack and group dropdowns with options', () => {
    render(<WorkloadExplorerPage />);

    const stackSelect = screen.getByTestId('stack-select');
    const groupSelect = screen.getByTestId('group-select');

    expect(stackSelect).toBeInTheDocument();
    expect(stackSelect).toHaveAttribute('data-value', 'workers');
    expect(groupSelect).toBeInTheDocument();
    expect(groupSelect).toHaveAttribute('data-value', '__all__');
    expect(screen.getByText('All stacks')).toBeInTheDocument();
    expect(screen.getAllByText('workers').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('billing')).toBeInTheDocument();
    expect(screen.getByText('All groups')).toBeInTheDocument();
    expect(screen.getAllByText('System').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Workload').length).toBeGreaterThanOrEqual(1);
  });

  it('filters table rows using selected stack from URL', () => {
    render(<WorkloadExplorerPage />);

    expect(screen.getByTestId('workloads-table')).toHaveTextContent('workers-api-1');
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('billing-api-1');
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('beyla');
  });

  it('renders WorkloadSmartSearch with totalCount', () => {
    mockQueryString = 'endpoint=1&stack=workers';
    render(<WorkloadExplorerPage />);

    const search = screen.getByTestId('workload-smart-search');
    expect(search).toBeInTheDocument();
    // workers stack filters to 1 container
    expect(search).toHaveAttribute('data-total', '1');
  });

  it('filters table rows via WorkloadSmartSearch onFiltered', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);

    // Initially all 3 containers shown
    expect(screen.getByTestId('workloads-table')).toHaveTextContent('workers-api-1');
    expect(screen.getByTestId('workloads-table')).toHaveTextContent('billing-api-1');
    expect(screen.getByTestId('workloads-table')).toHaveTextContent('beyla');

    // Simulate WorkloadSmartSearch calling onFiltered with a subset
    act(() => {
      mockOnFiltered?.([{ id: 'c-workers', name: 'workers-api-1' }]);
    });

    expect(screen.getByTestId('workloads-table')).toHaveTextContent('workers-api-1');
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('billing-api-1');
  });

  it('includes stack field in CSV export rows', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    const [rows] = mockExportToCsv.mock.calls[0] as [Array<Record<string, unknown>>];
    const workersRow = rows.find((r) => r.name === 'workers-api-1');
    const beylaRow = rows.find((r) => r.name === 'beyla');
    expect(workersRow?.stack).toBe('workers');
    expect(beylaRow?.stack).toBe('No Stack');
  });

  it('renders active filter chips when filters are active', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('Endpoint:')).toBeInTheDocument();
    expect(screen.getByText('Stack:')).toBeInTheDocument();
    expect(screen.getByText('Group:')).toBeInTheDocument();
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('does not render filter chips when no filters are active', () => {
    mockQueryString = '';
    render(<WorkloadExplorerPage />);

    expect(screen.queryByText('Endpoint:')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
  });

  it('does not show Clear all with only one active filter', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('Endpoint:')).toBeInTheDocument();
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
  });

  it('removes specific filter when chip dismiss button is clicked', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload';
    render(<WorkloadExplorerPage />);

    // Click the dismiss button for the Stack chip
    const dismissStackButton = screen.getByRole('button', { name: 'Remove Stack filter' });
    fireEvent.click(dismissStackButton);

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    expect(params).toEqual({ endpoint: '1', group: 'workload' });
  });

  it('renders state filter chip when state param is set', () => {
    mockQueryString = 'endpoint=1&state=running';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('State:')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('removes state filter chip when dismiss button is clicked', () => {
    mockQueryString = 'endpoint=1&state=running';
    render(<WorkloadExplorerPage />);

    const dismissStateButton = screen.getByRole('button', { name: 'Remove State filter' });
    fireEvent.click(dismissStateButton);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ search: 'endpoint=1' });
  });

  it('clears all filters when Clear all is clicked', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload';
    render(<WorkloadExplorerPage />);

    fireEvent.click(screen.getByText('Clear all'));

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    expect(params).toEqual({});
  });

  it('renders WorkloadStatusSummary with pre-state container count', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);

    const summary = screen.getByTestId('workload-status-summary');
    expect(summary).toBeInTheDocument();
    // All 3 containers (no stack/group filter, no state filter)
    expect(summary).toHaveAttribute('data-count', '3');
    expect(summary).toHaveAttribute('data-active', '');
  });

  it('renders WorkloadStatusSummary with active state from URL', () => {
    mockQueryString = 'endpoint=1&state=running';
    render(<WorkloadExplorerPage />);

    const summary = screen.getByTestId('workload-status-summary');
    expect(summary).toHaveAttribute('data-active', 'running');
  });

  it('renders state filter dropdown', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);
    const stateSelect = screen.getByTestId('state-select');
    expect(stateSelect).toBeInTheDocument();
    expect(stateSelect).toHaveAttribute('data-value', '__all__');
  });

  it('filters by state when state param is set', () => {
    mockQueryString = 'endpoint=1&state=running';
    render(<WorkloadExplorerPage />);
    // All mock containers are running, so all should show
    expect(screen.getByTestId('workloads-table')).toHaveTextContent('workers-api-1');
    expect(screen.getByTestId('workloads-table')).toHaveTextContent('beyla');
    expect(screen.getByTestId('workloads-table')).toHaveTextContent('billing-api-1');
  });

  it('filters out containers when state does not match', () => {
    mockQueryString = 'endpoint=1&state=stopped';
    render(<WorkloadExplorerPage />);
    // No mock containers are stopped, table should be empty
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('workers-api-1');
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('beyla');
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('billing-api-1');
  });

  it('exports visible rows to CSV', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(mockExportToCsv).toHaveBeenCalledTimes(1);
    const [rows, filename] = mockExportToCsv.mock.calls[0];
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as Array<Record<string, unknown>>).length).toBe(3);
    expect((rows as Array<Record<string, unknown>>).some((row) => row.group === 'System')).toBe(true);
    expect(filename).toMatch(/^workload-explorer-endpoint-1-all-stacks-all-groups-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('passes enableRowSelection and maxSelection to DataTable', () => {
    render(<WorkloadExplorerPage />);
    const table = screen.getByTestId('workloads-table');
    expect(table).toHaveAttribute('data-enable-row-selection', 'true');
    expect(table).toHaveAttribute('data-max-selection', '4');
  });

  it('passes row click navigation handler to DataTable', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workloads-table')).toHaveAttribute('data-has-row-click', 'true');
  });

  it('does not show selection action bar when fewer than 2 containers selected', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.queryByTestId('selection-action-bar')).not.toBeInTheDocument();
  });

  it('shows selection action bar when 2+ containers are selected', () => {
    render(<WorkloadExplorerPage />);

    act(() => {
      mockOnSelectionChange?.([
        { id: 'c-workers', name: 'workers-api-1', endpointId: 1 },
        { id: 'c-billing', name: 'billing-api-1', endpointId: 1 },
      ]);
    });

    expect(screen.getByTestId('selection-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('compare-button')).toBeInTheDocument();
  });

  it('navigates to compare mode via setSearchParams when compare button is clicked', () => {
    render(<WorkloadExplorerPage />);

    act(() => {
      mockOnSelectionChange?.([
        { id: 'c-workers', name: 'workers-api-1', endpointId: 1 },
        { id: 'c-billing', name: 'billing-api-1', endpointId: 1 },
      ]);
    });

    fireEvent.click(screen.getByTestId('compare-button'));

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const [nextParams, options] = mockSetSearchParams.mock.calls[0] as [URLSearchParams, { replace: boolean }];
    expect(nextParams.get('mode')).toBe('compare');
    expect(nextParams.get('containers')).toBe('1:c-workers,1:c-billing');
    // Filter params preserved
    expect(nextParams.get('endpoint')).toBe('1');
    expect(nextParams.get('stack')).toBe('workers');
    expect(options).toEqual({ replace: false });
  });

  it('clears selection when clear button is clicked', () => {
    render(<WorkloadExplorerPage />);

    act(() => {
      mockOnSelectionChange?.([
        { id: 'c-workers', name: 'workers-api-1', endpointId: 1 },
        { id: 'c-billing', name: 'billing-api-1', endpointId: 1 },
      ]);
    });

    expect(screen.getByTestId('selection-action-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('clear-selection'));

    expect(screen.queryByTestId('selection-action-bar')).not.toBeInTheDocument();
    // Verify DataTable receives empty selectedRowIds to clear internal checkboxes
    const table = screen.getByTestId('workloads-table');
    expect(table).toHaveAttribute('data-selected-row-ids', '{}');
  });

  it('preserves endpoint, group, and state filters when clicking a stack column cell (#1031)', () => {
    // Set up URL with endpoint, group, and state filters active
    mockQueryString = 'endpoint=1&group=workload&state=running';
    render(<WorkloadExplorerPage />);

    // Find the stack column definition from the columns passed to DataTable
    const stackColumn = mockColumns?.find(
      (col: { id?: string }) => col.id === 'stack'
    );
    expect(stackColumn).toBeDefined();

    // Render the stack cell for a container that belongs to a stack
    const workerContainer = {
      id: 'c-workers',
      name: 'workers-api-1',
      image: 'workers:latest',
      state: 'running',
      status: 'Up',
      endpointId: 1,
      endpointName: 'local',
      ports: [],
      created: 1700000000,
      labels: { 'com.docker.compose.project': 'workers' },
      networks: [],
    };

    // Simulate what TanStack Table does: call the cell renderer
    const cellResult = stackColumn.cell({
      row: { original: workerContainer },
      getValue: () => undefined,
    });

    // Render the cell so we can click the stack button
    const { container } = render(cellResult);
    const stackButton = container.querySelector('button');
    expect(stackButton).not.toBeNull();
    fireEvent.click(stackButton!);

    // The critical assertion: setSearchParams should be called with ALL active
    // filter values preserved, not just the stack. Before the fix, endpoint,
    // group, and state would be lost due to stale closure.
    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    expect(params).toEqual({
      endpoint: '1',
      stack: 'workers',
      group: 'workload',
      state: 'running',
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1046 — Filter chip render + removal coverage
  // (locks in regressions for #1031 stale-closure and #1035 state-chip)
  // -------------------------------------------------------------------------

  it('renders all four filter chips (endpoint, stack, group, state) simultaneously when active (#1046)', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload&state=running';
    render(<WorkloadExplorerPage />);

    // All four chip labels must render
    expect(screen.getByText('Endpoint:')).toBeInTheDocument();
    expect(screen.getByText('Stack:')).toBeInTheDocument();
    expect(screen.getByText('Group:')).toBeInTheDocument();
    expect(screen.getByText('State:')).toBeInTheDocument();

    // Each chip should have a corresponding "Remove ... filter" dismiss button
    expect(
      screen.getByRole('button', { name: 'Remove Endpoint filter' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Stack filter' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Group filter' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove State filter' })
    ).toBeInTheDocument();

    // With 4 active filters, "Clear all" is also present
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('renders state filter chip with capitalized value matching #1035 implementation', () => {
    // #1035 added the state chip; before the fix, the chip never rendered.
    // The chip value should be the capitalized state name (e.g. "Running").
    mockQueryString = 'endpoint=1&state=paused';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('State:')).toBeInTheDocument();
    // Capitalized value (state.charAt(0).toUpperCase() + state.slice(1))
    expect(screen.getByText('Paused')).toBeInTheDocument();
    // Removable via dismiss button (regression for the #1035 bug —
    // before the fix, the chip wasn't rendered at all so couldn't be removed)
    expect(
      screen.getByRole('button', { name: 'Remove State filter' })
    ).toBeInTheDocument();
  });

  it('removes endpoint filter from URL params when endpoint chip dismiss is clicked', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload&state=running';
    render(<WorkloadExplorerPage />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Endpoint filter' })
    );

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    // endpoint is dropped, all other active filters remain
    expect(params).toEqual({
      stack: 'workers',
      group: 'workload',
      state: 'running',
    });
    expect(params).not.toHaveProperty('endpoint');
  });

  it('removes group filter from URL params when group chip dismiss is clicked', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload&state=running';
    render(<WorkloadExplorerPage />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Group filter' })
    );

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    // group is dropped, all other active filters remain
    expect(params).toEqual({
      endpoint: '1',
      stack: 'workers',
      state: 'running',
    });
    expect(params).not.toHaveProperty('group');
  });

  it('preserves state filter when clicking a stack column cell with only endpoint+state active (#1031 + #1035)', () => {
    // Tighter regression: #1035 added state to the URL params, and #1031 fixed
    // the stale closure in the stack column's onClick handler. This test asserts
    // that even when only endpoint+state are active (no group), clicking a stack
    // cell preserves the state param — the case that #1035 introduced and #1031
    // had to learn about.
    mockQueryString = 'endpoint=1&state=running';
    render(<WorkloadExplorerPage />);

    const stackColumn = mockColumns?.find(
      (col: { id?: string }) => col.id === 'stack'
    );
    expect(stackColumn).toBeDefined();

    const workerContainer = {
      id: 'c-workers',
      name: 'workers-api-1',
      image: 'workers:latest',
      state: 'running',
      status: 'Up',
      endpointId: 1,
      endpointName: 'local',
      ports: [],
      created: 1700000000,
      labels: { 'com.docker.compose.project': 'workers' },
      networks: [],
    };

    const cellResult = stackColumn.cell({
      row: { original: workerContainer },
      getValue: () => undefined,
    });

    const { container } = render(cellResult);
    const stackButton = container.querySelector('button');
    expect(stackButton).not.toBeNull();
    fireEvent.click(stackButton!);

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    // Both endpoint and state must be preserved — pre-#1031 the closure
    // dropped them; pre-#1035 the state chip wouldn't have been visible
    // even if the state param were preserved.
    expect(params).toEqual({
      endpoint: '1',
      stack: 'workers',
      state: 'running',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compare-mode URL contract
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkloadExplorerPage — compare mode', () => {
  beforeEach(() => {
    mockQueryString = '';
    mockSetSearchParams.mockReset();
    mockNavigate.mockReset();
    mockUseContainers.mockReturnValue(defaultContainersMock);
    mockOnRemoveFromComparison = undefined;
  });

  it('renders ContainerComparisonView when mode=compare and containers param is set with valid ids', () => {
    // Two containers from the default mock: c-workers (endpointId 1) and c-billing (endpointId 1)
    mockQueryString = 'mode=compare&containers=1:c-workers,1:c-billing';
    render(<WorkloadExplorerPage />);

    // ContainerComparisonView is rendered (mocked stub)
    expect(screen.getByTestId('container-comparison-view')).toBeInTheDocument();
    // Default tab is metrics — the stub renders CPU Usage and Memory Usage
    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();

    // The table should NOT be in the DOM in compare mode
    expect(screen.queryByTestId('workloads-table')).not.toBeInTheDocument();
  });

  it('shows the "no containers" empty state when mode=compare but no containers param is set', () => {
    mockQueryString = 'mode=compare';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('No containers to compare')).toBeInTheDocument();
    // There are two back buttons (header + empty state) — assert at least one is present
    const backBtns = screen.getAllByRole('button', { name: /← Back to list/i });
    expect(backBtns.length).toBeGreaterThanOrEqual(1);

    // ContainerComparisonView stub should NOT be present
    expect(screen.queryByTestId('container-comparison-view')).not.toBeInTheDocument();
  });

  it('shows the "needs at least 2" empty state when only 1 container resolves', () => {
    // Only one container id in the param; the mock data only has c-workers
    mockQueryString = 'mode=compare&containers=1:c-workers';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('Compare needs at least 2 containers')).toBeInTheDocument();
    expect(screen.queryByTestId('container-comparison-view')).not.toBeInTheDocument();
  });

  it('Back to list strips mode/containers/tab/range but preserves filter params', () => {
    // c-workers and c-billing are both in the default mock data,
    // so compared.length === 2 and ContainerComparisonView is shown.
    mockQueryString = 'endpoint=1&stack=workers&mode=compare&containers=1:c-workers,1:c-billing&tab=config&range=24h';
    render(<WorkloadExplorerPage />);

    // In compare mode the header always shows a "← Back to list" button
    const backBtn = screen.getByRole('button', { name: /← Back to list/i });
    fireEvent.click(backBtn);

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const [nextParams] = mockSetSearchParams.mock.calls[0] as [URLSearchParams, unknown];
    // Filter params preserved
    expect(nextParams.get('endpoint')).toBe('1');
    expect(nextParams.get('stack')).toBe('workers');
    // Compare-mode params stripped
    expect(nextParams.get('mode')).toBeNull();
    expect(nextParams.get('containers')).toBeNull();
    expect(nextParams.get('tab')).toBeNull();
    expect(nextParams.get('range')).toBeNull();
  });

  it('clicking a pill × removes that container from the containers param', () => {
    // Three containers in the URL; remove the first (c-workers / web-app alias: workers-api-1)
    mockQueryString = 'mode=compare&containers=1:c-workers,1:c-beyla,1:c-billing';
    render(<WorkloadExplorerPage />);

    // Confirm all three resolved
    expect(screen.getByTestId('container-comparison-view')).toHaveAttribute(
      'data-container-count',
      '3',
    );

    // The ContainerComparisonView mock renders a remove button per container.
    // Click the × for workers-api-1.
    fireEvent.click(screen.getByRole('button', { name: 'Remove workers-api-1 from comparison' }));

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const [nextParams] = mockSetSearchParams.mock.calls[0] as [URLSearchParams, unknown];
    // c-workers is removed; c-beyla and c-billing remain
    expect(nextParams.get('containers')).toBe('1:c-beyla,1:c-billing');
    // mode is preserved (still in compare mode with 2 remaining containers)
    expect(nextParams.get('mode')).toBe('compare');
  });
});
