import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();
const mockRefetch = vi.fn();
const mockForceRefresh = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ endpointId: '1', containerId: 'c1' }),
  useSearchParams: () => [new URLSearchParams('tab=metrics'), mockSetSearchParams],
  useNavigate: () => mockNavigate,
}));

vi.mock('@/features/containers/hooks/use-container-detail', () => ({
  useContainerDetail: () => ({
    data: {
      id: 'c1',
      name: 'api',
      image: 'nginx:latest',
      state: 'running',
      status: 'Up 5m',
      endpointId: 1,
      endpointName: 'local',
      ports: [],
      created: 1700000000,
      labels: {},
      networks: ['frontend'],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    isFetching: false,
  }),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({
    forceRefresh: mockForceRefresh,
    isForceRefreshing: false,
  }),
}));

vi.mock('@/shared/components/ui/favorite-button', () => ({
  FavoriteButton: () => <button type="button">Favorite</button>,
}));

vi.mock('@/shared/components/ui/refresh-button', () => ({
  RefreshButton: () => <button type="button" data-testid="refresh-button">Refresh</button>,
}));

vi.mock('@/features/containers/components/container/container-overview', () => ({
  ContainerOverview: () => <div>Overview</div>,
}));

vi.mock('@/features/containers/components/container/container-logs-viewer', () => ({
  ContainerLogsViewer: () => <div>Logs</div>,
}));

vi.mock('@/features/containers/components/container/container-metrics-viewer', () => ({
  ContainerMetricsViewer: () => <div>Metrics</div>,
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [], isLoading: false }),
  useEndpointCapabilities: () => ({
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    isEdgeAsync: false,
    endpoint: undefined,
  }),
}));

import ContainerDetailPage from './container-detail';

describe('ContainerDetailPage', () => {
  it('renders metrics time selector to the left of refresh in header controls', () => {
    render(<ContainerDetailPage />);

    const controls = screen.getByTestId('metrics-header-controls');
    const timeRangeControl = screen.getByTestId('metrics-time-range-control');
    const refreshButton = screen.getByTestId('refresh-button');

    expect(controls.firstElementChild).toBe(timeRangeControl);
    expect(controls.lastElementChild).toBe(refreshButton);
    expect(screen.getByTestId('time-range-selector')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 hour' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6 hours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24 hours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument();
  });
});
