import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './home';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 30) }, (_, i) => ({
        index: i,
        start: i * 48,
        end: (i + 1) * 48,
        size: 48,
        key: i,
      })),
    getTotalSize: () => count * 48,
    measureElement: vi.fn(),
  })),
}));

vi.mock('@/hooks/use-dashboard', () => ({
  useDashboard: vi.fn(),
}));

vi.mock('@/hooks/use-containers', () => ({
  useFavoriteContainers: () => ({ data: [] }),
}));

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [] }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn(), enabled: true, toggle: vi.fn() }),
}));

vi.mock('@/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({ forceRefresh: vi.fn(), isForceRefreshing: false }),
}));

vi.mock('@/hooks/use-kpi-history', () => ({
  useKpiHistory: () => ({ data: null }),
}));

vi.mock('@/stores/favorites-store', () => ({
  useFavoritesStore: () => [],
}));

// Mock chart components that use canvas/SVG
vi.mock('@/components/charts/container-state-pie', () => ({
  ContainerStatePie: () => <div data-testid="mock-pie">Pie</div>,
}));
vi.mock('@/components/charts/endpoint-health-treemap', () => ({
  EndpointHealthTreemap: () => <div data-testid="mock-treemap">Treemap</div>,
}));
vi.mock('@/components/charts/endpoint-health-octagons', () => ({
  EndpointHealthOctagons: () => <div data-testid="mock-octagons">Octagons</div>,
}));
vi.mock('@/components/charts/workload-top-bar', () => ({
  WorkloadTopBar: () => <div data-testid="mock-workload">Workload</div>,
}));
vi.mock('@/components/charts/fleet-summary-card', () => ({
  FleetSummaryCard: () => <div data-testid="mock-fleet">Fleet</div>,
}));
vi.mock('@/components/charts/resource-overview-card', () => ({
  ResourceOverviewCard: () => <div data-testid="mock-resource">Resource</div>,
}));
vi.mock('@/components/shared/kpi-card', () => ({
  KpiCard: ({ label }: { label: string }) => <div data-testid="mock-kpi">{label}</div>,
}));
vi.mock('@/components/shared/tilt-card', () => ({
  TiltCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shared/spotlight-card', () => ({
  SpotlightCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shared/motion-page', () => ({
  MotionPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionReveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionStagger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shared/auto-refresh-toggle', () => ({
  AutoRefreshToggle: () => <div data-testid="mock-auto-refresh" />,
}));
vi.mock('@/components/shared/refresh-button', () => ({
  RefreshButton: () => <button data-testid="mock-refresh" />,
}));
vi.mock('@/components/shared/smart-refresh-controls', () => ({
  SmartRefreshControls: () => <div data-testid="mock-smart-refresh" />,
}));
vi.mock('@/components/shared/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock('@/components/shared/favorite-button', () => ({
  FavoriteButton: () => <button data-testid="mock-fav" />,
}));
vi.mock('@/hooks/use-nl-query', () => ({
  useNlQuery: () => ({ mutate: vi.fn(), isPending: false, data: null, error: null }),
}));

import { useDashboard } from '@/hooks/use-dashboard';
import type { NormalizedContainer, DashboardSummary } from '@/hooks/use-dashboard';

const mockUseDashboard = vi.mocked(useDashboard);

function makeContainer(i: number): NormalizedContainer {
  return {
    id: `c-${i}`,
    name: `container-${i}`,
    image: `nginx:${i}`,
    state: i % 2 === 0 ? 'running' : 'stopped',
    status: i % 2 === 0 ? 'Up 2 hours' : 'Exited (0)',
    created: Math.floor(Date.now() / 1000) - i * 60,
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    networks: [],
    labels: {},
  };
}

function makeDashboardData(containerCount: number): DashboardSummary {
  return {
    kpis: {
      endpoints: 2,
      endpointsUp: 2,
      endpointsDown: 0,
      running: containerCount,
      stopped: 0,
      healthy: containerCount,
      unhealthy: 0,
      total: containerCount,
      stacks: 1,
    },
    security: {
      totalAudited: 10,
      flagged: 0,
      ignored: 0,
    },
    recentContainers: Array.from({ length: containerCount }, (_, i) => makeContainer(i)),
    timestamp: new Date().toISOString(),
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HomePage - Recent Containers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Recent Containers section with title and inline search', () => {
    mockUseDashboard.mockReturnValue({
      data: makeDashboardData(5),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText('Recent Containers')).toBeInTheDocument();
    expect(screen.getByLabelText('Smart container search')).toBeInTheDocument();
  });

  it('renders smart search instead of DataTable built-in search', () => {
    mockUseDashboard.mockReturnValue({
      data: makeDashboardData(5),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // The smart search should be present
    expect(screen.getByLabelText('Smart container search')).toBeInTheDocument();
  });

  it('renders container rows up to page size', () => {
    const containerCount = 15;
    mockUseDashboard.mockReturnValue({
      data: makeDashboardData(containerCount),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // With pageSize=10, the first 10 containers should be visible
    for (let i = 0; i < 10; i++) {
      expect(screen.getAllByText(`container-${i}`).length).toBeGreaterThan(0);
    }
  });

  it('filters containers when typing in the inline search', async () => {
    mockUseDashboard.mockReturnValue({
      data: makeDashboardData(10),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    const searchInput = screen.getByLabelText('Smart container search');
    fireEvent.change(searchInput, { target: { value: 'container-3' } });

    // container-3 should be visible (may appear in both desktop table + mobile card list)
    await waitFor(() => {
      expect(screen.getAllByText('container-3').length).toBeGreaterThan(0);
      // container-0 should be filtered out
      expect(screen.queryByText('container-0')).not.toBeInTheDocument();
    });
  });

  it('renders all expected columns', () => {
    mockUseDashboard.mockReturnValue({
      data: makeDashboardData(3),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Endpoint')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('shows skeleton when loading', () => {
    mockUseDashboard.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // Should not show the search or table when loading
    expect(screen.queryByLabelText('Smart container search')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Containers')).not.toBeInTheDocument();
  });
});
