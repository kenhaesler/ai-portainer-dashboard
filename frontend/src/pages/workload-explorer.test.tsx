import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('endpoint=1&stack=workers'), mockSetSearchParams],
  useNavigate: () => mockNavigate,
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

import WorkloadExplorerPage from './workload-explorer';

describe('WorkloadExplorerPage', () => {
  it('renders stack dropdown with available stack options', () => {
    render(<WorkloadExplorerPage />);

    const stackSelect = screen.getByTestId('stack-select');
    expect(stackSelect).toBeInTheDocument();
    expect(stackSelect).toHaveAttribute('data-value', 'workers');
    expect(screen.getByText('All stacks')).toBeInTheDocument();
    expect(screen.getByText('workers')).toBeInTheDocument();
    expect(screen.getByText('billing')).toBeInTheDocument();
  });

  it('filters table rows using selected stack from URL', () => {
    render(<WorkloadExplorerPage />);

    expect(screen.getByTestId('workloads-table')).toHaveTextContent('workers-api-1');
    expect(screen.getByTestId('workloads-table')).not.toHaveTextContent('billing-api-1');
  });
});
