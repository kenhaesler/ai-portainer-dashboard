import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import FleetOverviewPage from './fleet-overview';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock the hooks
vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
}));

vi.mock('@/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({ forceRefresh: vi.fn(), isForceRefreshing: false }),
}));

import { useEndpoints } from '@/hooks/use-endpoints';
import type { Endpoint } from '@/hooks/use-endpoints';

const mockUseEndpoints = vi.mocked(useEndpoints);

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 1,
    name: 'test-endpoint',
    type: 1,
    url: 'tcp://10.0.0.1:9001',
    status: 'up',
    containersRunning: 5,
    containersStopped: 1,
    containersHealthy: 4,
    containersUnhealthy: 0,
    totalContainers: 6,
    stackCount: 2,
    totalCpu: 4,
    totalMemory: 8589934592,
    isEdge: false,
    edgeMode: null,
    snapshotAge: null,
    checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FleetOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FleetOverviewPage — Edge metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  it('renders Edge Agent Standard badge for Edge endpoints', () => {
    mockUseEndpoints.mockReturnValue({
      data: [
        makeEndpoint({
          id: 1,
          name: 'edge-env',
          isEdge: true,
          edgeMode: 'standard',
          snapshotAge: 30000,
          lastCheckIn: Math.floor(Date.now() / 1000) - 30,
          checkInInterval: 5,
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText(/Edge Agent Standard/)).toBeInTheDocument();
    expect(screen.getByText(/Check-in:/)).toBeInTheDocument();
    expect(screen.getByText(/Snapshot:/)).toBeInTheDocument();
  });

  it('renders Edge Agent Async badge for async endpoints', () => {
    mockUseEndpoints.mockReturnValue({
      data: [
        makeEndpoint({
          id: 2,
          name: 'async-env',
          isEdge: true,
          edgeMode: 'async',
          snapshotAge: 120000,
          lastCheckIn: Math.floor(Date.now() / 1000) - 120,
          checkInInterval: 60,
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText(/Edge Agent Async/)).toBeInTheDocument();
  });

  it('does not render Edge badge for non-Edge endpoints', () => {
    mockUseEndpoints.mockReturnValue({
      data: [
        makeEndpoint({ id: 3, name: 'standard-env', isEdge: false, edgeMode: null }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.queryByText(/Edge Agent Standard/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Edge Agent Async/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check-in:/)).not.toBeInTheDocument();
  });

  it('navigates to /workloads?endpoint=<id> when endpoint card is clicked', () => {
    mockUseEndpoints.mockReturnValue({
      data: [makeEndpoint({ id: 7, name: 'click-env' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    const card = screen.getByRole('button', { name: /click-env/ });
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/workloads?endpoint=7');
  });

  it('shows snapshot age with color coding for stale endpoints', () => {
    const staleAge = 10 * 60 * 1000; // 10 minutes, > 5min threshold
    mockUseEndpoints.mockReturnValue({
      data: [
        makeEndpoint({
          id: 4,
          name: 'stale-env',
          isEdge: true,
          edgeMode: 'standard',
          snapshotAge: staleAge,
          lastCheckIn: Math.floor(Date.now() / 1000) - 600,
          checkInInterval: 5,
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // Should show snapshot info
    expect(screen.getByText(/Snapshot:/)).toBeInTheDocument();
  });

  it('auto-switches to table view when endpoint count > 100', () => {
    const endpoints = Array.from({ length: 120 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockUseEndpoints.mockReturnValue({
      data: endpoints,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // Should have auto-switched to table view — DataTable will be rendered
    // The grid pagination should NOT be visible (since we're in table mode)
    expect(screen.queryByTestId('grid-pagination')).not.toBeInTheDocument();
    // The DataTable search input should be present
    expect(screen.getByTestId('data-table-search')).toBeInTheDocument();
  });

  it('paginates grid view with 30 items per page', () => {
    const endpoints = Array.from({ length: 45 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockUseEndpoints.mockReturnValue({
      data: endpoints,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // Should show grid pagination (45 endpoints > 30 page size)
    expect(screen.getByTestId('grid-pagination')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();

    // Only first 30 should be rendered
    expect(screen.getByText('env-1')).toBeInTheDocument();
    expect(screen.getByText('env-30')).toBeInTheDocument();
    expect(screen.queryByText('env-31')).not.toBeInTheDocument();
  });

  it('navigates grid pages', () => {
    const endpoints = Array.from({ length: 45 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockUseEndpoints.mockReturnValue({
      data: endpoints,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    const nextBtn = screen.getByTestId('grid-next-page');
    fireEvent.click(nextBtn);

    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText('env-31')).toBeInTheDocument();
    expect(screen.queryByText('env-1')).not.toBeInTheDocument();
  });

  it('does not show grid pagination when all endpoints fit on one page', () => {
    const endpoints = Array.from({ length: 10 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockUseEndpoints.mockReturnValue({
      data: endpoints,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.queryByTestId('grid-pagination')).not.toBeInTheDocument();
  });
});
