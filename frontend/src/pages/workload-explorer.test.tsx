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

vi.mock('@/components/shared/data-table', () => ({
  DataTable: ({ data }: { data: Array<{ name: string }> }) => (
    <div data-testid="workloads-table">{data.map((container) => container.name).join(',')}</div>
  ),
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

vi.mock('@/lib/motion-tokens', () => ({
  transition: { fast: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } },
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    span: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => <span {...Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'layout'].includes(k)))}>{children}</span>,
  },
  useReducedMotion: () => false,
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
    mockSetSearchParams.mockReset();
    mockExportToCsv.mockReset();
    mockOnFiltered = undefined;
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

  it('clears all filters when Clear all is clicked', () => {
    mockQueryString = 'endpoint=1&stack=workers&group=workload';
    render(<WorkloadExplorerPage />);

    fireEvent.click(screen.getByText('Clear all'));

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const params = mockSetSearchParams.mock.calls[0][0];
    expect(params).toEqual({});
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
