import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  useContainerDetail: vi.fn(),
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
import { useContainerDetail } from '@/features/containers/hooks/use-container-detail';

const mockUseContainerDetail = vi.mocked(useContainerDetail);

const defaultContainerData = {
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
};

beforeEach(() => {
  mockUseContainerDetail.mockReturnValue({
    data: defaultContainerData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    isFetching: false,
  } as any);
});

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

// ── Empty / unavailable fleet (#1420) ───────────────────────────────────────

describe('ContainerDetailPage — empty/unavailable fleet (#1420)', () => {
  it('renders the error affordance without throwing when container query returns error', () => {
    mockUseContainerDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Portainer unreachable'),
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    expect(() => render(<ContainerDetailPage />)).not.toThrow();
    expect(screen.getByText('Container not found')).toBeInTheDocument();
  });

  it('renders the error affordance without throwing when container query returns undefined data', () => {
    mockUseContainerDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    expect(() => render(<ContainerDetailPage />)).not.toThrow();
    // page shows container-not-found since !container
    expect(screen.getByText('Container not found')).toBeInTheDocument();
  });
});
