import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('@/features/core/hooks/use-dashboard', () => ({
  useDashboard: vi.fn(),
}));

vi.mock('@/features/core/hooks/use-dashboard-full', () => ({
  useDashboardFull: vi.fn(),
}));

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useFavoriteContainers: () => ({ data: [] }),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [] }),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn(), enabled: true, toggle: vi.fn() }),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({ forceRefresh: vi.fn(), isForceRefreshing: false }),
}));

vi.mock('@/features/observability/hooks/use-kpi-history', () => ({
  useKpiHistory: () => ({ data: null }),
}));

vi.mock('@/stores/favorites-store', () => ({
  useFavoritesStore: () => [],
}));

// Mock chart components that use canvas/SVG
vi.mock('@/shared/components/charts/container-state-pie', () => ({
  ContainerStatePie: () => <div data-testid="mock-pie">Pie</div>,
}));
vi.mock('@/shared/components/charts/endpoint-health-treemap', () => ({
  EndpointHealthTreemap: () => <div data-testid="mock-treemap">Treemap</div>,
}));
vi.mock('@/shared/components/charts/endpoint-health-octagons', () => ({
  EndpointHealthOctagons: () => <div data-testid="mock-octagons">Octagons</div>,
}));
vi.mock('@/shared/components/charts/workload-top-bar', () => ({
  WorkloadTopBar: () => <div data-testid="mock-workload">Workload</div>,
}));
vi.mock('@/shared/components/charts/fleet-summary-card', () => ({
  FleetSummaryCard: () => <div data-testid="mock-fleet">Fleet</div>,
}));
vi.mock('@/shared/components/charts/resource-overview-card', () => ({
  ResourceOverviewCard: () => <div data-testid="mock-resource">Resource</div>,
}));
vi.mock('@/shared/components/kpi-card', () => ({
  KpiCard: ({ label }: { label: string }) => <div data-testid="mock-kpi">{label}</div>,
}));
vi.mock('@/shared/components/tilt-card', () => ({
  TiltCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/components/spotlight-card', () => ({
  SpotlightCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/components/motion-page', () => ({
  MotionPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionReveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionStagger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/components/auto-refresh-toggle', () => ({
  AutoRefreshToggle: () => <div data-testid="mock-auto-refresh" />,
}));
vi.mock('@/shared/components/refresh-button', () => ({
  RefreshButton: () => <button data-testid="mock-refresh" />,
}));
vi.mock('@/shared/components/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock('@/shared/components/favorite-button', () => ({
  FavoriteButton: () => <button data-testid="mock-fav" />,
}));
vi.mock('@/features/ai-intelligence/hooks/use-nl-query', () => ({
  useNlQuery: () => ({ mutate: vi.fn(), isPending: false, data: null, error: null }),
}));

import { useDashboardFull } from '@/features/core/hooks/use-dashboard-full';
import type { DashboardSummary } from '@/features/core/hooks/use-dashboard';

const mockUseDashboardFull = vi.mocked(useDashboardFull);

function makeDashboardData() {
  return {
    summary: {
      kpis: {
        endpoints: 2,
        endpointsUp: 2,
        endpointsDown: 0,
        running: 5,
        stopped: 0,
        healthy: 5,
        unhealthy: 0,
        total: 5,
        stacks: 1,
      },
      security: {
        totalAudited: 10,
        flagged: 0,
        ignored: 0,
      },
      timestamp: new Date().toISOString(),
    } as DashboardSummary,
    resources: {
      fleetCpuPercent: 50,
      fleetMemoryPercent: 60,
      topStacks: [],
    },
    endpoints: [],
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

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders KPI cards when data is loaded', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Running Containers')).toBeInTheDocument();
    expect(screen.getByText('Stopped Containers')).toBeInTheDocument();
    expect(screen.getByText('Stacks')).toBeInTheDocument();
    expect(screen.getByText('Security Findings')).toBeInTheDocument();
  });

  it('does not render Recent Containers section (#801)', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.queryByText('Recent Containers')).not.toBeInTheDocument();
  });

  it('shows error state when data fetch fails', () => {
    mockUseDashboardFull.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Connection refused'),
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('shows skeleton cards when loading', () => {
    mockUseDashboardFull.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // KPI cards should not be visible while loading
    expect(screen.queryByText('Endpoints')).not.toBeInTheDocument();
  });

  it('renders the page subtitle without mentioning recent containers', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.getByText('Dashboard overview with KPIs and charts')).toBeInTheDocument();
  });
});
