import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();
const mockRefetch = vi.fn();
const mockForceRefresh = vi.fn();

const state = vi.hoisted(() => ({
  search: 'tab=metrics',
  isLoading: false,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ endpointId: '1', containerId: 'c1abcdef01234567' }),
  useSearchParams: () => [new URLSearchParams(state.search), mockSetSearchParams],
  useNavigate: () => mockNavigate,
}));

vi.mock('@/features/containers/hooks/use-container-detail', () => ({
  useContainerDetail: () => ({
    data: state.isLoading
      ? undefined
      : {
          id: 'c1abcdef01234567',
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
    isLoading: state.isLoading,
    isError: false,
    error: null,
    refetch: mockRefetch,
    isFetching: false,
    dataUpdatedAt: Date.now(),
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

vi.mock('@/features/containers/components/container/container-overview', () => ({
  ContainerOverview: () => <div>Overview</div>,
}));

vi.mock('@/features/containers/components/container/container-logs-viewer', () => ({
  ContainerLogsViewer: () => <div>Logs</div>,
}));

vi.mock('@/features/containers/components/container/container-metrics-viewer', () => ({
  ContainerMetricsViewer: () => <div>Metrics</div>,
}));

vi.mock('@/features/containers/components/container-traces-tab', () => ({
  ContainerTracesTab: () => <div>Traces panel</div>,
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

beforeEach(() => {
  state.search = 'tab=metrics';
  state.isLoading = false;
  localStorage.clear();
  mockRefetch.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ContainerDetailPage header controls', () => {
  it('renders metrics time selector, then freshness, then the refresh controls', () => {
    render(<ContainerDetailPage />);

    const controls = screen.getByTestId('metrics-header-controls');
    const timeRangeControl = screen.getByTestId('metrics-time-range-control');

    expect(controls.firstElementChild).toBe(timeRangeControl);
    expect(screen.getByTestId('time-range-selector')).toBeInTheDocument();
    for (const label of ['15 min', '30 min', '1 hour', '6 hours', '24 hours', '7 days']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // The page used to offer a manual Refresh button only — the one screen in
    // the drill-down cluster that never updated itself.
    expect(screen.getByLabelText('Auto-refresh interval')).toBeInTheDocument();
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });

  it('refetches on the auto-refresh tick', () => {
    vi.useFakeTimers();
    render(<ContainerDetailPage />);

    expect(mockRefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });

  it('keeps its own refresh cadence rather than sharing the fleet-wide key', () => {
    render(<ContainerDetailPage />);

    expect(localStorage.getItem('ai-portainer-auto-refresh:container-detail')).not.toBeNull();
    expect(localStorage.getItem('ai-portainer-auto-refresh')).toBeNull();
  });
});

describe('ContainerDetailPage tabs', () => {
  it('names the trace tab Traces, matching the rest of the product', () => {
    render(<ContainerDetailPage />);

    expect(screen.getByRole('tab', { name: 'Traces' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Calls' })).not.toBeInTheDocument();
  });

  it('still resolves the old ?tab=calls links to the Traces tab', () => {
    state.search = 'tab=calls';
    render(<ContainerDetailPage />);

    expect(screen.getByRole('tab', { name: 'Traces' })).toHaveAttribute(
      'data-state',
      'active'
    );
    expect(screen.getByText('Traces panel')).toBeInTheDocument();
  });
});

describe('ContainerDetailPage loading state', () => {
  it('uses the shared PageHeader and drops the generic subtitle prose', () => {
    state.isLoading = true;
    render(<ContainerDetailPage />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Container Details');
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
    expect(
      screen.queryByText('View detailed information about a container')
    ).not.toBeInTheDocument();
    // The subtitle carries the ids already known from the URL.
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      'c1abcdef0123 • endpoint 1'
    );
  });
});
