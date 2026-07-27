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

// Captures the `onTick` the page passes so a test can assert the refresh
// dropdown actually schedules fetches (the hook owns the timer since #phase-1).
const capturedAutoRefresh: { onTick?: () => void } = {};
vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (_default?: number, opts?: { onTick?: () => void }) => {
    capturedAutoRefresh.onTick = opts?.onTick;
    return {
      interval: 30,
      setRefreshInterval: vi.fn(),
      setInterval: vi.fn(),
      enabled: true,
      toggle: vi.fn(),
      options: [0, 15, 30, 60, 120, 300],
    };
  },
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
    capturedAutoRefresh.onTick = undefined;
    // Default: containers query is idle / empty. Individual tests override
    // this when they need a specific fleet shape (e.g. 9 healthy / 1 unhealthy).
    mockUseContainers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
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

  it('renders the Security Findings tile as a real link to the audit page', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    // Was an onClick-only div-ish button: no href, no middle-click, no
    // "open in new tab", and indistinguishable from the five dead tiles.
    expect(screen.getByTestId('fleet-tile-link-Security Findings')).toHaveAttribute(
      'href',
      '/security/audit',
    );
  });

  it('links the Stopped tile into a filtered Workload Explorer', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseContainers.mockReturnValue({
      data: [makeContainer({ id: 'e1', name: 'e1', state: 'stopped' })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderPage();

    // `state=stopped`, the contract vocabulary. This assertion previously
    // pinned `state=exited` — and the fixture above built its container from
    // the same word, so the test agreed with the bug instead of catching it:
    // the tile was linking to a filter that could only ever return no rows.
    expect(screen.getByTestId('fleet-tile-link-Stopped')).toHaveAttribute(
      'href',
      '/workloads?state=stopped',
    );
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

  it('leads with a needs-attention count and keeps the pass rate secondary', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    const healthy = Array.from({ length: 9 }, (_, i) =>
      makeContainer({ id: `h${i}`, name: `h${i}`, healthStatus: 'healthy' }),
    );
    const unhealthy = [makeContainer({ id: 'u0', name: 'u0', healthStatus: 'unhealthy' })];
    mockUseContainers.mockReturnValue({
      data: [...healthy, ...unhealthy],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderPage();

    expect(screen.getByTestId('health-score-card')).toBeInTheDocument();
    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('1');
    // The old hero: "Overall Health Score 90.0%" in a ring that never moved.
    expect(screen.queryByText(/Overall Health Score/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent('90%');
  });

  it('spends the subtitle on live fleet state rather than naming its own widgets', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.queryByText('Dashboard overview with KPIs and charts')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '2 endpoints · 5 containers',
    );
  });

  it('renders the page title through the shared PageHeader', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('Home');
  });

  // ---------------------------------------------------------------------------
  // The refresh control used to schedule nothing on this page while rendering a
  // pulsing "live" dot, and nothing on screen showed when the data landed.
  // ---------------------------------------------------------------------------

  it('wires the auto-refresh dropdown to real refetches via onTick', () => {
    const refetch = vi.fn();
    const refetchContainers = vi.fn();
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as any);
    mockUseContainers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: refetchContainers,
    } as any);

    renderPage();

    expect(capturedAutoRefresh.onTick).toBeTypeOf('function');
    capturedAutoRefresh.onTick?.();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetchContainers).toHaveBeenCalledTimes(1);
  });

  it('shows a data-freshness stamp beside the refresh control', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as any);

    renderPage();

    const actions = screen.getByTestId('page-header-actions');
    expect(within(actions).getByText(/^Updated /)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Fix by subtraction: "everything is running" was stated seven times above one
  // fold, two of those arithmetically guaranteed complements.
  // ---------------------------------------------------------------------------

  it('no longer renders the Fleet Summary card or its Top Contributors ranking', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.queryByText('Fleet Summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-fleet')).not.toBeInTheDocument();
  });

  it('does not title a card "Top Workloads" when it holds no workloads', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    expect(screen.queryByText('Top Workloads')).not.toBeInTheDocument();
    expect(screen.getByText('Stacks by container count')).toBeInTheDocument();
  });
});
