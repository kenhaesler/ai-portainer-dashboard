import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Container, UseContainersParams } from '@/features/containers/hooks/use-containers';

const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();
const mockExportToCsv = vi.fn();
let mockQueryString = 'endpoint=1&stack=workers';

vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(mockQueryString), mockSetSearchParams],
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
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

const defaultContainers: Container[] = [
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
];

/**
 * The slice of `useContainers()`'s `UseQueryResult` that the page reads.
 * `data` is optional-by-value and `error` nullable for the same reason TanStack
 * types them that way: the loading and error branches below assert the page
 * survives a query that has no data yet.
 */
interface ContainersQuery {
  data: Container[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: Mock<() => void>;
  isFetching: boolean;
  /** Epoch ms of the last successful fetch; 0 until the query first resolves. */
  dataUpdatedAt: number;
}

// `satisfies` rather than a plain annotation so `defaultContainersMock.data[0]`
// stays a `Container` for the cell-renderer tests below.
const defaultContainersMock = {
  data: defaultContainers,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn<() => void>(),
  isFetching: false,
  dataUpdatedAt: 0,
} satisfies ContainersQuery;

type UseContainersFn = (params?: UseContainersParams) => ContainersQuery;

const mockUseContainers = vi.fn<UseContainersFn>(() => defaultContainersMock);

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: (...args: Parameters<UseContainersFn>) => mockUseContainers(...args),
}));

let mockAutoRefreshOptions: { onTick?: () => void } | undefined;

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (_interval?: number, opts?: { onTick?: () => void }) => {
    mockAutoRefreshOptions = opts;
    return {
      interval: 30,
      setRefreshInterval: vi.fn(),
      setInterval: vi.fn(),
    };
  },
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
let mockRowHref: ((row: any) => string) | undefined;
let mockRowLabel: ((row: any) => string) | undefined;

vi.mock('@/shared/components/tables/data-table', () => ({
  DataTable: ({
    columns,
    data,
    enableRowSelection,
    maxSelection,
    onSelectionChange,
    selectedRowIds,
    onRowClick,
    autoFit,
    minTableWidth,
    rowHref,
    rowLabel,
  }: {
    columns?: any[];
    data: Array<{ name: string }>;
    enableRowSelection?: boolean;
    maxSelection?: number;
    onSelectionChange?: (rows: Array<{ id: string; name: string; endpointId: number }>) => void;
    selectedRowIds?: Record<string, boolean>;
    onRowClick?: (row: { id: string; name: string; endpointId: number }) => void;
    autoFit?: boolean;
    minTableWidth?: number;
    rowHref?: (row: any) => string;
    rowLabel?: (row: any) => string;
  }) => {
    mockOnSelectionChange = onSelectionChange;
    mockColumns = columns;
    mockRowHref = rowHref;
    mockRowLabel = rowLabel;
    return (
      <div
        data-testid="workloads-table"
        data-enable-row-selection={enableRowSelection ? 'true' : undefined}
        data-max-selection={maxSelection}
        data-selected-row-ids={selectedRowIds !== undefined ? JSON.stringify(selectedRowIds) : undefined}
        data-has-row-click={onRowClick ? 'true' : undefined}
        data-auto-fit={autoFit ? 'true' : undefined}
        data-min-table-width={minTableWidth}
      >
        {data.map((container) => container.name).join(',')}
      </div>
    );
  },
}));

vi.mock('@/shared/components/feedback/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/shared/components/ui/refresh-controls', () => ({
  RefreshControls: () => <button type="button">Refresh</button>,
}));

vi.mock('@/shared/components/ui/favorite-button', () => ({
  FavoriteButton: () => <button type="button">Favorite</button>,
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
  m: {
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

import { findDestination } from '@/features/core/lib/navigation-manifest';
import WorkloadExplorerPage from './workload-explorer';

describe('WorkloadExplorerPage', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1&stack=workers';
    mockSetSearchParams.mockReset();
    mockExportToCsv.mockReset();
    mockNavigate.mockReset();
    mockOnFiltered = undefined;
    mockOnSelectionChange = undefined;
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
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('endpoint')).toBe('1');
    expect(params.get('group')).toBe('workload');
    expect(params.get('stack')).toBeNull();
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
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('endpoint')).toBeNull();
    expect(params.get('stack')).toBeNull();
    expect(params.get('group')).toBeNull();
  });

  it('does not render the WorkloadStatusSummary totals row (#1313)', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);
    expect(screen.queryByTestId('workload-status-summary')).not.toBeInTheDocument();
  });

  it('renders the search bar above the filter dropdowns', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);
    const search = screen.getByTestId('workload-smart-search');
    const endpointSelect = screen.getByTestId('endpoint-select');
    // endpoint dropdown follows the search bar in document order
    expect(
      search.compareDocumentPosition(endpointSelect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('merges filter dropdowns and table into a single pane (#1313)', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);

    // The state dropdown (a filter control) and the data table must share
    // the same SpotlightCard ancestor, rather than living in two separate
    // SpotlightCard blocks the way they did before #1313.
    const stateSelect = screen.getByTestId('state-select');
    const table = screen.getByTestId('workloads-table');

    const pane = screen.getByTestId('workload-pane');
    expect(pane.contains(stateSelect)).toBe(true);
    expect(pane.contains(table)).toBe(true);

    // Only one inner pane exists on the page.
    expect(screen.getAllByTestId('workload-pane')).toHaveLength(1);
  });

  it('uses compact pane padding so the header/filters/table fit without scrolling', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);
    // p-4 (not p-6) trims vertical chrome so the page fits within standard
    // laptop viewport heights without forcing a scroll.
    expect(screen.getByTestId('workload-pane')).toHaveClass('p-4');
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
    expect(filename).toMatch(/^workload-explorer-endpoint-1-all-stacks-all-groups-all-images-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('includes the active image filter (sanitized) in the CSV filename scope', () => {
    mockQueryString = 'endpoint=1&image=workers%3Alatest';
    render(<WorkloadExplorerPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(mockExportToCsv).toHaveBeenCalledTimes(1);
    const [, filename] = mockExportToCsv.mock.calls[0];
    // "workers:latest" → image-workers-latest (':' is not filename-safe)
    expect(filename).toMatch(
      /^workload-explorer-endpoint-1-all-stacks-all-groups-image-workers-latest-\d{4}-\d{2}-\d{2}\.csv$/,
    );
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
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('endpoint')).toBe('1');
    expect(params.get('stack')).toBe('workers');
    expect(params.get('group')).toBe('workload');
    expect(params.get('state')).toBe('running');
  });

  // -------------------------------------------------------------------------
  // Clickable State / Endpoint / Group / Image column cells (filter-on-click,
  // mirroring the Stack cell). Each preserves the other active filters.
  // -------------------------------------------------------------------------

  it('clicking the State cell filters by state, preserving other active filters', () => {
    mockQueryString = 'endpoint=1&group=workload';
    render(<WorkloadExplorerPage />);

    const stateColumn = mockColumns?.find(
      (col: { accessorKey?: string }) => col.accessorKey === 'state'
    );
    expect(stateColumn).toBeDefined();

    const cellResult = stateColumn.cell({ getValue: () => 'running' });
    const { container } = render(cellResult);
    const stateButton = container.querySelector('button');
    expect(stateButton).not.toBeNull();
    fireEvent.click(stateButton!);

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('state')).toBe('running');
    expect(params.get('endpoint')).toBe('1');
    expect(params.get('group')).toBe('workload');
  });

  it('clicking the Endpoint cell filters by endpoint (clearing stack), preserving group/state', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload&state=running';
    render(<WorkloadExplorerPage />);

    const endpointColumn = mockColumns?.find(
      (col: { accessorKey?: string }) => col.accessorKey === 'endpointName'
    );
    expect(endpointColumn).toBeDefined();

    const cellResult = endpointColumn.cell({
      row: { original: { endpointId: 2, endpointName: 'remote' } },
    });
    const { container } = render(cellResult);
    const endpointButton = container.querySelector('button');
    expect(endpointButton).not.toBeNull();
    fireEvent.click(endpointButton!);

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('endpoint')).toBe('2');
    // Switching endpoint clears the (endpoint-scoped) stack filter…
    expect(params.get('stack')).toBeNull();
    // …but keeps the cross-endpoint filters.
    expect(params.get('group')).toBe('workload');
    expect(params.get('state')).toBe('running');
  });

  it('still offers group filtering via the Group dropdown after the Group column was dropped', () => {
    mockQueryString = 'endpoint=1&state=running';
    render(<WorkloadExplorerPage />);
    // The column went away; the filter did not.
    expect(screen.getByTestId('group-select')).toBeInTheDocument();
    expect(screen.getAllByText('System').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Workload').length).toBeGreaterThanOrEqual(1);
  });

  it('clicking the Image cell filters by image, preserving other filters', () => {
    mockQueryString = 'endpoint=1&group=workload';
    render(<WorkloadExplorerPage />);

    const imageColumn = mockColumns?.find(
      (col: { accessorKey?: string }) => col.accessorKey === 'image'
    );
    expect(imageColumn).toBeDefined();

    const cellResult = imageColumn.cell({ getValue: () => 'nginx:1.25' });
    const { container } = render(cellResult);
    const imageButton = container.querySelector('button');
    expect(imageButton).not.toBeNull();
    fireEvent.click(imageButton!);

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('image')).toBe('nginx:1.25');
    expect(params.get('endpoint')).toBe('1');
    expect(params.get('group')).toBe('workload');
  });

  it('renders an Image filter chip when an image filter is active and removes it on dismiss', () => {
    mockQueryString = 'endpoint=1&image=nginx%3A1.25';
    render(<WorkloadExplorerPage />);

    expect(screen.getByText('Image:')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Image filter' }));

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(params.get('image')).toBeNull();
    expect(params.get('endpoint')).toBe('1');
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
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    // endpoint is dropped, all other active filters remain
    expect(params.get('stack')).toBe('workers');
    expect(params.get('group')).toBe('workload');
    expect(params.get('state')).toBe('running');
    expect(params.get('endpoint')).toBeNull();
  });

  it('removes group filter from URL params when group chip dismiss is clicked', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload&state=running';
    render(<WorkloadExplorerPage />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Group filter' })
    );

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    // group is dropped, all other active filters remain
    expect(params.get('endpoint')).toBe('1');
    expect(params.get('stack')).toBe('workers');
    expect(params.get('state')).toBe('running');
    expect(params.get('group')).toBeNull();
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
    const params = mockSetSearchParams.mock.calls[0][0] as URLSearchParams;
    // Both endpoint and state must be preserved — pre-#1031 the closure
    // dropped them; pre-#1035 the state chip wouldn't have been visible
    // even if the state param were preserved.
    expect(params.get('endpoint')).toBe('1');
    expect(params.get('stack')).toBe('workers');
    expect(params.get('state')).toBe('running');
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
    const [nextParams, options] = mockSetSearchParams.mock.calls[0] as [URLSearchParams, { replace: boolean }];
    // Filter params preserved
    expect(nextParams.get('endpoint')).toBe('1');
    expect(nextParams.get('stack')).toBe('workers');
    // Compare-mode params stripped
    expect(nextParams.get('mode')).toBeNull();
    expect(nextParams.get('containers')).toBeNull();
    expect(nextParams.get('tab')).toBeNull();
    expect(nextParams.get('range')).toBeNull();
    expect(options).toEqual({ replace: false });
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

// ─────────────────────────────────────────────────────────────────────────────
// Header Compare button
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkloadExplorerPage — header Compare button', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockSetSearchParams.mockReset();
    mockNavigate.mockReset();
    mockUseContainers.mockReturnValue(defaultContainersMock);
    mockOnSelectionChange = undefined;
  });

  it('renders the Compare button in the header in table mode, disabled when no rows selected', () => {
    render(<WorkloadExplorerPage />);

    const button = screen.getByRole('button', { name: /^Compare$/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Select 2 or more containers to compare');
  });

  it('does NOT render the header Compare button in compare mode', () => {
    mockQueryString = 'mode=compare&containers=1:c-workers,1:c-billing';
    render(<WorkloadExplorerPage />);

    expect(screen.queryByRole('button', { name: /^Compare( \d+)?$/ })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Header toolbar — pill-style Compare / Export CSV (#1311)
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkloadExplorerPage — header toolbar pill buttons (#1311)', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockSetSearchParams.mockReset();
    mockNavigate.mockReset();
    mockUseContainers.mockReturnValue(defaultContainersMock);
  });

  it('renders Export CSV in the header toolbar (not in the filter pane)', () => {
    render(<WorkloadExplorerPage />);

    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    const compareBtn = screen.getByRole('button', { name: /^Compare$/ });
    // Both must share an ancestor `<div>` (the header toolbar). The filter
    // pane sits inside a SpotlightCard; the header is just a flex row.
    const headerToolbar = compareBtn.parentElement;
    expect(headerToolbar).not.toBeNull();
    expect(headerToolbar?.contains(exportBtn)).toBe(true);
  });

  it('renders header buttons left-to-right as Compare → Export CSV → Refresh', () => {
    render(<WorkloadExplorerPage />);

    const compareBtn = screen.getByRole('button', { name: /^Compare$/ });
    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    // Refresh button comes from the RefreshButton primitive; match by name.
    const refreshBtn = screen.getByRole('button', { name: /Refresh/i });

    const order = [compareBtn, exportBtn, refreshBtn].map((el) =>
      Array.prototype.indexOf.call(el.parentElement?.children ?? [], el),
    );
    // All three sit in the same flex row (header toolbar), and their
    // indices are strictly ascending.
    expect(compareBtn.parentElement).toBe(exportBtn.parentElement);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('Compare and Export CSV use the pill chrome (rounded-full + h-10)', () => {
    render(<WorkloadExplorerPage />);

    const compareBtn = screen.getByRole('button', { name: /^Compare$/ });
    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });

    for (const btn of [compareBtn, exportBtn]) {
      expect(btn).toHaveClass('rounded-full');
      expect(btn).toHaveClass('h-10');
      expect(btn).toHaveClass('border-input');
      expect(btn).toHaveClass('bg-background');
    }
  });

  it('Compare stays disabled when fewer than 2 containers are selected', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByRole('button', { name: /^Compare$/ })).toBeDisabled();
  });

  it('Export CSV disabled-state semantics still trigger handleExportCsv when clicked enabled', () => {
    render(<WorkloadExplorerPage />);
    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);
    expect(mockExportToCsv).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Column set, ordering, and cell rendering (#1288)
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkloadExplorerPage — columns (#1288)', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockSetSearchParams.mockReset();
    mockNavigate.mockReset();
    mockUseContainers.mockReturnValue(defaultContainersMock);
    mockColumns = undefined;
  });

  function columnHeader(col: any): string | undefined {
    return typeof col?.header === 'string' ? col.header : undefined;
  }

  it('renders columns in order Name, Favourite, Stack, State, Endpoint, Image (no Actions column)', () => {
    render(<WorkloadExplorerPage />);
    const ids = mockColumns?.map((c) => c.id ?? c.accessorKey);
    // The favourite star has its own column so the Name cell can be wrapped in
    // the row anchor — an <a> may not contain a <button>.
    expect(ids).toEqual(['name', 'favorite', 'stack', 'state', 'endpointName', 'image']);
  });

  it('labels the stack and image columns Stack and Image, matching the filter dropdowns', () => {
    render(<WorkloadExplorerPage />);
    const stack = mockColumns?.find((c) => c.id === 'stack');
    const image = mockColumns?.find((c) => c.accessorKey === 'image');
    // "Stackname"/"Imagename" were data keys typed as labels, while the
    // dropdowns directly above them said Stack and Endpoint.
    expect(columnHeader(stack)).toBe('Stack');
    expect(columnHeader(image)).toBe('Image');
  });

  it('drops the Group column, which drew an identical unlabelled icon on every row', () => {
    render(<WorkloadExplorerPage />);
    const ids = new Set(mockColumns?.map((c) => c.id ?? c.accessorKey));
    expect(ids.has('group')).toBe(false);
  });

  it('omits the rate, errorRate, p95Ms, and age columns', () => {
    render(<WorkloadExplorerPage />);
    const ids = new Set(mockColumns?.map((c) => c.id ?? c.accessorKey));
    expect(ids.has('rate')).toBe(false);
    expect(ids.has('errorRate')).toBe(false);
    expect(ids.has('p95Ms')).toBe(false);
    expect(ids.has('age')).toBe(false);
  });

  it('passes autoFit to the DataTable', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workloads-table')).toHaveAttribute('data-auto-fit', 'true');
  });

  it('passes minTableWidth to the DataTable for horizontal scrolling', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workloads-table')).toHaveAttribute('data-min-table-width', '770');
  });

  it('Imagename cell renders only the segment after the last "/" with the full path on title', () => {
    render(<WorkloadExplorerPage />);
    const imageCol = mockColumns?.find((c) => c.accessorKey === 'image');
    expect(imageCol).toBeDefined();
    const cellResult = imageCol.cell({
      row: { original: defaultContainersMock.data[0] },
      getValue: () => 'registry.harbor.example.com/library/team-x/api-service:1.4.2',
    });
    const { container } = render(cellResult);
    // Now a clickable filter button (like the Stack cell): short name shown,
    // full path retained in the "Filter by image: …" title.
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('api-service:1.4.2');
    expect(button?.getAttribute('title')).toBe(
      'Filter by image: registry.harbor.example.com/library/team-x/api-service:1.4.2',
    );
  });

  it('Name cell tag is single-line and contains no interactive element', () => {
    render(<WorkloadExplorerPage />);
    const nameCol = mockColumns?.find((c) => c.accessorKey === 'name');
    expect(nameCol).toBeDefined();
    const cellResult = nameCol.cell({
      row: { original: defaultContainersMock.data[0] },
      getValue: () => 'workers-api-1',
    });
    const { container } = render(cellResult);
    const tag = container.querySelector('span.bg-primary\\/10');
    expect(tag).not.toBeNull();
    expect(tag?.className).toContain('whitespace-nowrap');
    // DataTable wraps this cell in the row's <a href>; a nested button would
    // be invalid HTML and would swallow the link.
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('marks only system containers with an inline System chip in the Name cell', () => {
    render(<WorkloadExplorerPage />);
    const nameCol = mockColumns?.find((c) => c.accessorKey === 'name');

    // beyla (grafana/beyla) is classified as a system container.
    const { container: sys } = render(
      nameCol.cell({
        row: { original: defaultContainersMock.data[1] },
        getValue: () => 'beyla',
      }),
    );
    expect(sys.textContent).toContain('System');

    // A plain workload carries no chip — the column has variance now.
    const { container: workload } = render(
      nameCol.cell({
        row: { original: defaultContainersMock.data[0] },
        getValue: () => 'workers-api-1',
      }),
    );
    expect(workload.textContent).not.toContain('System');
  });

  it('renders the favourite star in its own column with an accessible header', () => {
    render(<WorkloadExplorerPage />);
    const favCol = mockColumns?.find((c) => c.id === 'favorite');
    expect(favCol).toBeDefined();
    const { container } = render(favCol.header());
    expect(container.querySelector('.sr-only')?.textContent).toBe('Favourite');
  });

  it('Stackname cell renders the stack tag with whitespace-nowrap', () => {
    render(<WorkloadExplorerPage />);
    const stackCol = mockColumns?.find((c) => c.id === 'stack');
    const cellResult = stackCol.cell({
      row: { original: defaultContainersMock.data[0] },
      getValue: () => undefined,
    });
    const { container } = render(cellResult);
    const tagButton = container.querySelector('button');
    expect(tagButton).not.toBeNull();
    expect(tagButton?.className).toContain('whitespace-nowrap');
  });

  it('uses theme tokens, not raw palette colours, for the Stack and Endpoint cells', () => {
    render(<WorkloadExplorerPage />);
    const stackCol = mockColumns?.find((c) => c.id === 'stack');
    const endpointCol = mockColumns?.find((c) => c.accessorKey === 'endpointName');

    const { container: stackC } = render(
      stackCol.cell({ row: { original: defaultContainersMock.data[0] }, getValue: () => undefined }),
    );
    const stackBtn = stackC.querySelector('button');
    // purple is reserved for AI insight; the app ships 8 light themes, so a
    // hardcoded purple-100/purple-900 pair fails on most of them.
    expect(stackBtn?.className).not.toMatch(/purple/);

    const { container: epC } = render(
      endpointCol.cell({ row: { original: { endpointId: 1, endpointName: 'local' } } }),
    );
    const epBtn = epC.querySelector('button');
    // The saturated blue pill was the highest-chroma element on the page and
    // repeated one value on every row.
    expect(epBtn?.className).not.toMatch(/blue/);
    expect(epBtn?.className).toContain('text-muted-foreground');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Design-critique remediation: header, auto-refresh, row links, mobile cards
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkloadExplorerPage — page header', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockSetSearchParams.mockReset();
    mockNavigate.mockReset();
    mockUseContainers.mockReturnValue(defaultContainersMock);
  });

  it('renders exactly one h1, titled with the nav manifest label', () => {
    render(<WorkloadExplorerPage />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    // The sidebar says "Workloads"; the page used to say "Workload Explorer".
    expect(headings[0]).toHaveTextContent(findDestination('/workloads')!.label);
    expect(headings[0]).toHaveTextContent('Workloads');
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('replaces the "Browse and manage containers" subtitle with live counts', () => {
    render(<WorkloadExplorerPage />);
    // Observer-first: nothing on this page manages anything.
    expect(screen.queryByText(/browse and manage containers/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '3 containers across 1 endpoint',
    );
  });

  it('singularises the subtitle for a single container', () => {
    mockQueryString = 'endpoint=1&stack=workers';
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '1 container across 1 endpoint',
    );
  });

  it('keeps the subtitle visible on mobile, since it carries state the title does not', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('page-header-subtitle').className).not.toContain('hidden');
  });

  it('renders the same h1 while the containers query is still loading', () => {
    mockUseContainers.mockReturnValue({ ...defaultContainersMock, isLoading: true, data: undefined });
    render(<WorkloadExplorerPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workloads');
    // No fabricated "0 containers" count before the data has arrived.
    expect(screen.queryByTestId('page-header-subtitle')).not.toBeInTheDocument();
  });

  it('renders the h1 on the error branch too', () => {
    mockUseContainers.mockReturnValue({
      ...defaultContainersMock,
      isError: true,
      error: new Error('boom'),
      data: undefined,
    });
    render(<WorkloadExplorerPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workloads');
    expect(screen.getByText('Failed to load containers')).toBeInTheDocument();
  });
});

describe('WorkloadExplorerPage — auto-refresh actually refreshes', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockSetSearchParams.mockReset();
    mockNavigate.mockReset();
    mockAutoRefreshOptions = undefined;
  });

  it('passes onTick to useAutoRefresh, and the tick refetches', () => {
    const refetch = vi.fn();
    mockUseContainers.mockReturnValue({ ...defaultContainersMock, refetch });
    render(<WorkloadExplorerPage />);

    // Before this, the interval dropdown wrote a localStorage preference and
    // scheduled no fetch, while the control rendered a pulsing "live" dot.
    expect(mockAutoRefreshOptions?.onTick).toBeTypeOf('function');
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      mockAutoRefreshOptions!.onTick!();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a data-freshness stamp once the query reports an update time', () => {
    mockUseContainers.mockReturnValue({
      ...defaultContainersMock,
      dataUpdatedAt: Date.now() - 3000,
    });
    render(<WorkloadExplorerPage />);
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });

  it('shows no freshness stamp when the query has never resolved', () => {
    mockUseContainers.mockReturnValue({ ...defaultContainersMock, dataUpdatedAt: 0 });
    render(<WorkloadExplorerPage />);
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
  });
});

describe('WorkloadExplorerPage — rows are real links', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockRowHref = undefined;
    mockRowLabel = undefined;
    mockUseContainers.mockReturnValue(defaultContainersMock);
  });

  it('passes rowHref so cmd-click, middle-click and "copy link address" work', () => {
    render(<WorkloadExplorerPage />);
    expect(mockRowHref).toBeTypeOf('function');
    expect(mockRowHref!(defaultContainersMock.data[0])).toBe('/containers/1/c-workers');
  });

  it('passes a rowLabel naming the destination, so AT hears more than "row"', () => {
    render(<WorkloadExplorerPage />);
    expect(mockRowLabel!(defaultContainersMock.data[0])).toBe('Open container workers-api-1');
  });

  it('keeps the whole-row click handler alongside the anchor', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workloads-table')).toHaveAttribute('data-has-row-click', 'true');
  });
});

describe('WorkloadExplorerPage — mobile card list', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1';
    mockUseContainers.mockReturnValue(defaultContainersMock);
  });

  it('renders one card per visible container, each a real link', () => {
    render(<WorkloadExplorerPage />);
    const list = screen.getByTestId('workload-card-list');
    const links = list.querySelectorAll('a');
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute('href')).toBe('/containers/1/c-workers');
  });

  it('shows the state on every card — the question a phone is opened to answer', () => {
    render(<WorkloadExplorerPage />);
    const list = screen.getByTestId('workload-card-list');
    // StatusBadge is stubbed as the bare state string.
    expect(list.textContent).toContain('workers-api-1');
    expect(list.textContent).toContain('running');
  });

  it('shows stack and image on the second line', () => {
    render(<WorkloadExplorerPage />);
    const list = screen.getByTestId('workload-card-list');
    expect(list.textContent).toContain('workers · workers:latest');
    // A container with no stack says so rather than rendering a bare dot, and
    // the image drops its registry path to fit a phone-width card.
    expect(list.textContent).toContain('No stack · beyla:latest');
  });

  it('hides the table below md and the cards from md up', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workload-card-list').parentElement?.className).toContain('md:hidden');
    expect(screen.getByTestId('workloads-table').parentElement?.className).toContain('hidden');
    expect(screen.getByTestId('workloads-table').parentElement?.className).toContain('md:block');
  });

  it('mirrors the search-filtered rows, not the unfiltered list', () => {
    render(<WorkloadExplorerPage />);
    act(() => {
      mockOnFiltered?.([defaultContainersMock.data[0]]);
    });
    expect(screen.getByTestId('workload-card-list').querySelectorAll('a')).toHaveLength(1);
  });

  it('states plainly when nothing matches', () => {
    mockQueryString = 'endpoint=1&state=stopped';
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workload-card-list').textContent).toContain(
      'No containers match these filters.',
    );
  });
});
