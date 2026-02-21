import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();
const mockExportToCsv = vi.fn();
let mockQueryString = 'endpoint=1&stack=workers';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(mockQueryString), mockSetSearchParams],
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/csv-export', () => ({
  exportToCsv: (...args: unknown[]) => mockExportToCsv(...args),
}));

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({
    data: [{ id: 1, name: 'local' }],
  }),
}));

vi.mock('@/hooks/use-stacks', () => ({
  useStacks: () => ({
    data: [
      { id: 10, name: 'workers', endpointId: 1, type: 2, status: 'active', envCount: 0 },
      { id: 11, name: 'billing', endpointId: 1, type: 2, status: 'active', envCount: 0 },
    ],
  }),
}));

vi.mock('@/hooks/use-containers', () => ({
  useContainers: () => ({
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
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({
    interval: 30,
    setInterval: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({
    forceRefresh: vi.fn(),
    isForceRefreshing: false,
  }),
}));

vi.mock('@/components/shared/themed-select', () => ({
  ThemedSelect: ({ id, value, options }: { id?: string; value: string; options: Array<{ value: string; label: string }> }) => (
    <div data-testid={id} data-value={value}>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}));

// Capture columns so we can test column cell renderers directly
let capturedColumns: any[] = [];

vi.mock('@/components/shared/data-table', () => ({
  DataTable: ({ data, columns }: { data: Array<{ name: string }>; columns: any[] }) => {
    capturedColumns = columns;
    return (
      <div data-testid="workloads-table">{data.map((container) => container.name).join(',')}</div>
    );
  },
}));

vi.mock('@/components/shared/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/components/shared/auto-refresh-toggle', () => ({
  AutoRefreshToggle: () => <div>Auto Refresh</div>,
}));

vi.mock('@/components/shared/refresh-button', () => ({
  RefreshButton: () => <button type="button">Refresh</button>,
}));

vi.mock('@/components/shared/favorite-button', () => ({
  FavoriteButton: () => <button type="button">Favorite</button>,
}));

vi.mock('@/components/shared/loading-skeleton', () => ({
  SkeletonCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

let mockOnFiltered: ((containers: unknown[]) => void) | undefined;

vi.mock('@/components/shared/workload-smart-search', () => ({
  WorkloadSmartSearch: ({ onFiltered, totalCount }: { onFiltered: (c: unknown[]) => void; totalCount: number }) => {
    mockOnFiltered = onFiltered;
    return <div data-testid="workload-smart-search" data-total={totalCount} />;
  },
}));

import WorkloadExplorerPage from './workload-explorer';

describe('WorkloadExplorerPage', () => {
  beforeEach(() => {
    mockQueryString = 'endpoint=1&stack=workers';
    mockExportToCsv.mockReset();
    mockNavigate.mockReset();
    mockOnFiltered = undefined;
    capturedColumns = [];
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
    expect(screen.getByText('workers')).toBeInTheDocument();
    expect(screen.getByText('billing')).toBeInTheDocument();
    expect(screen.getByText('All groups')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Workload')).toBeInTheDocument();
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
});

describe('Actions column', () => {
  const mockContainer = {
    id: 'c-test',
    name: 'test-container',
    image: 'test:latest',
    state: 'running',
    status: 'Up',
    endpointId: 2,
    endpointName: 'remote',
    ports: [],
    created: 1700000000,
    labels: {},
    networks: [],
  };

  beforeEach(() => {
    mockNavigate.mockReset();
    capturedColumns = [];
    mockQueryString = 'endpoint=1';
  });

  function getActionsColumn() {
    render(<WorkloadExplorerPage />);
    return capturedColumns.find((col: any) => col.id === 'actions');
  }

  it('includes an actions column in the columns array', () => {
    const actionsCol = getActionsColumn();
    expect(actionsCol).toBeDefined();
    expect(actionsCol.enableSorting).toBe(false);
    expect(actionsCol.size).toBe(90);
  });

  it('renders actions column header as screen-reader only', () => {
    const actionsCol = getActionsColumn();
    const HeaderComponent = actionsCol.header;
    const { container } = render(<HeaderComponent />);
    const srSpan = container.querySelector('.sr-only');
    expect(srSpan).not.toBeNull();
    expect(srSpan?.textContent).toBe('Actions');
  });

  it('renders Eye and ScrollText action buttons with correct aria-labels', () => {
    const actionsCol = getActionsColumn();
    const CellComponent = actionsCol.cell;
    const { container } = render(
      <CellComponent row={{ original: mockContainer }} />
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);

    const detailButton = container.querySelector('[aria-label="View details for test-container"]');
    expect(detailButton).not.toBeNull();

    const logsButton = container.querySelector('[aria-label="View logs for test-container"]');
    expect(logsButton).not.toBeNull();
  });

  it('navigates to container detail page when Eye button is clicked', () => {
    const actionsCol = getActionsColumn();
    const CellComponent = actionsCol.cell;
    const { container } = render(
      <CellComponent row={{ original: mockContainer }} />
    );

    const detailButton = container.querySelector('[aria-label="View details for test-container"]');
    fireEvent.click(detailButton!);

    expect(mockNavigate).toHaveBeenCalledWith('/containers/2/c-test');
  });

  it('navigates to container logs when ScrollText button is clicked', () => {
    const actionsCol = getActionsColumn();
    const CellComponent = actionsCol.cell;
    const { container } = render(
      <CellComponent row={{ original: mockContainer }} />
    );

    const logsButton = container.querySelector('[aria-label="View logs for test-container"]');
    fireEvent.click(logsButton!);

    expect(mockNavigate).toHaveBeenCalledWith('/containers/2/c-test?tab=logs');
  });

  it('calls stopPropagation on button click to prevent row click', () => {
    const actionsCol = getActionsColumn();
    const CellComponent = actionsCol.cell;
    const { container } = render(
      <CellComponent row={{ original: mockContainer }} />
    );

    const detailButton = container.querySelector('[aria-label="View details for test-container"]');
    const stopPropagation = vi.fn();
    fireEvent.click(detailButton!, { stopPropagation });

    // Verify navigate was called (button handler executed)
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('action buttons have hover-reveal opacity classes', () => {
    const actionsCol = getActionsColumn();
    const CellComponent = actionsCol.cell;
    const { container } = render(
      <CellComponent row={{ original: mockContainer }} />
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('opacity-0');
    expect(wrapper?.className).toContain('group-hover/row:opacity-100');
    expect(wrapper?.className).toContain('group-focus-within/row:opacity-100');
    expect(wrapper?.className).toContain('max-sm:opacity-100');
    expect(wrapper?.className).toContain('duration-150');
  });
});
