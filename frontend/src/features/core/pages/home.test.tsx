import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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
  useContainers: vi.fn(),
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
vi.mock('@/shared/components/data-display/spotlight-card', () => ({
  SpotlightCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// Motion wrappers are mocked to plain divs, but they FORWARD className so the
// hero layout classes stay assertable (e.g. the absence of the old
// col-span-4 / col-span-1 split now that the pane is full-width).
vi.mock('@/shared/components/layout/motion-page', () => ({
  MotionPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  MotionReveal: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  MotionStagger: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock('@/shared/components/ui/refresh-controls', () => ({
  RefreshControls: () => <button data-testid="mock-refresh" />,
}));
vi.mock('@/shared/components/feedback/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock('@/shared/components/ui/favorite-button', () => ({
  FavoriteButton: () => <button data-testid="mock-fav" />,
}));
vi.mock('@/features/ai-intelligence/hooks/use-nl-query', () => ({
  useNlQuery: () => ({ mutate: vi.fn(), isPending: false, data: null, error: null }),
}));

import { useDashboardFull } from '@/features/core/hooks/use-dashboard-full';
import { useContainers } from '@/features/containers/hooks/use-containers';
import type { DashboardSummary } from '@/features/core/hooks/use-dashboard';
import type { Container } from '@/features/containers/hooks/use-containers';

const mockUseDashboardFull = vi.mocked(useDashboardFull);
const mockUseContainers = vi.mocked(useContainers);

function makeContainer(overrides: Partial<Container>): Container {
  return {
    id: 'c',
    name: 'c',
    image: 'nginx',
    state: 'running',
    status: 'Up 1 hour',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 0,
    labels: {},
    networks: [],
    ...overrides,
  };
}

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
    // Default: containers query is idle / empty. Individual tests override
    // this when they need a specific fleet shape (e.g. 9 healthy / 1 unhealthy).
    mockUseContainers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);
  });

  it('renders the Overall Health hero with its inner stat tiles, not the removed KPI cards', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseContainers.mockReturnValue({
      data: [makeContainer({ id: 'r1', name: 'r1', healthStatus: 'healthy' })],
      isLoading: false,
      isError: false,
    } as any);

    renderPage();

    // The Overall Health pane now carries the same inner stat tiles as the
    // Health & Monitoring hero.
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Running')).toBeInTheDocument();
    expect(within(hero).getByText('Healthy')).toBeInTheDocument();
    expect(within(hero).getByText('Unhealthy')).toBeInTheDocument();
    expect(within(hero).getByText('No Healthcheck')).toBeInTheDocument();
    // Security Findings and Stopped now live INSIDE the health pane.
    expect(within(hero).getByText('Security Findings')).toBeInTheDocument();
    expect(within(hero).getByText('Stopped')).toBeInTheDocument();

    // ...but the standalone Endpoints / Running / Stopped / Stacks KPI cards
    // are removed — those numbers now live inside the health pane.
    expect(screen.queryByText('Endpoints')).not.toBeInTheDocument();
    expect(screen.queryByText('Running Containers')).not.toBeInTheDocument();
    expect(screen.queryByText('Stopped Containers')).not.toBeInTheDocument();
    expect(screen.queryByText('Stacks')).not.toBeInTheDocument();
  });

  it('renders the Overall Health pane full-width with Security Findings nested inside', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    const hero = screen.getByTestId('fleet-health-hero');
    // No more 4:1 split: the hero is not inside a col-span-4 column...
    expect(hero.closest('[class*="col-span-4"]')).toBeNull();
    // ...and Security Findings is no longer a separate col-span-1 card.
    const security = screen.getByText('Security Findings');
    expect(security.closest('[class*="col-span-1"]')).toBeNull();
    // Security Findings is nested inside the health hero.
    expect(within(hero).getByText('Security Findings')).toBeInTheDocument();
  });

  it('navigates to the security audit when the Security Findings tile is clicked', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Security Findings/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/security/audit');
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

  it('does not render the removed KPI cards while loading', () => {
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

  it('renders the Overall Health Score with 9 healthy / 1 unhealthy (green)', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    // 9 healthy + 1 unhealthy → score = 90.0% → green band (>= 80%)
    const healthy = Array.from({ length: 9 }, (_, i) =>
      makeContainer({ id: `h${i}`, name: `h${i}`, healthStatus: 'healthy' }),
    );
    const unhealthy = [makeContainer({ id: 'u0', name: 'u0', healthStatus: 'unhealthy' })];
    mockUseContainers.mockReturnValue({
      data: [...healthy, ...unhealthy],
      isLoading: false,
      isError: false,
    } as any);

    renderPage();

    expect(screen.getByTestId('health-score-card')).toBeInTheDocument();
    expect(screen.getByTestId('health-score')).toHaveTextContent('90.0%');
    // ≥80% renders the green CheckCircle2 icon.
    expect(screen.getByTestId('health-score-icon-green')).toBeInTheDocument();
    expect(screen.getByText('9 of 10 reporting healthy')).toBeInTheDocument();
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

describe('HomePage — empty/unavailable fleet (#1420)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContainers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);
  });

  it('degrades gracefully when fleet data is empty (no throw, shows heading)', () => {
    // Empty-success: all hooks return empty arrays — simulates Portainer unavailable
    mockUseDashboardFull.mockReturnValue({
      data: { summary: null, resources: null, endpoints: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseContainers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);

    expect(() => renderPage()).not.toThrow();
    expect(screen.getByText('Dashboard overview with KPIs and charts')).toBeInTheDocument();
  });
});
