import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InfrastructurePage from './infrastructure';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(),
}));

vi.mock('@/hooks/use-stacks', () => ({
  useStacks: vi.fn(),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    request: vi.fn().mockResolvedValue({}),
  },
}));

import { useEndpoints } from '@/hooks/use-endpoints';
import { useStacks } from '@/hooks/use-stacks';
import type { Endpoint } from '@/hooks/use-endpoints';
import type { Stack } from '@/hooks/use-stacks';
import { useUiStore } from '@/stores/ui-store';

const mockUseEndpoints = vi.mocked(useEndpoints);
const mockUseStacks = vi.mocked(useStacks);

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

function makeStack(overrides: Partial<Stack> = {}): Stack {
  return {
    id: 1,
    name: 'test-stack',
    type: 2,
    endpointId: 1,
    status: 'active',
    envCount: 3,
    source: 'portainer',
    ...overrides,
  };
}

function mockEndpoints(endpoints: Endpoint[], extra = {}) {
  mockUseEndpoints.mockReturnValue({
    data: endpoints,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    ...extra,
  } as any);
}

function mockStacks(stacks: Stack[], extra = {}) {
  mockUseStacks.mockReturnValue({
    data: stacks,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    ...extra,
  } as any);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InfrastructurePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InfrastructurePage — page structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useUiStore.setState({ pageViewModes: {} });
    mockEndpoints([makeEndpoint()]);
    mockStacks([makeStack()]);
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Infrastructure' })).toBeInTheDocument();
  });

  it('renders Fleet Overview and Stack Overview section headings', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Fleet Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stack Overview' })).toBeInTheDocument();
  });
});

describe('InfrastructurePage — summary bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ pageViewModes: {} });
  });

  it('shows correct endpoint counts in summary bar', () => {
    mockEndpoints([
      makeEndpoint({ id: 1, name: 'ep1', status: 'up' }),
      makeEndpoint({ id: 2, name: 'ep2', status: 'up' }),
      makeEndpoint({ id: 3, name: 'ep3', status: 'down' }),
    ]);
    mockStacks([]);

    renderPage();

    const summaryBar = screen.getByTestId('summary-bar');
    expect(summaryBar).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-total')).toHaveTextContent('3 endpoints');
    expect(screen.getByTestId('endpoint-up')).toHaveTextContent('2 up');
    expect(screen.getByTestId('endpoint-down')).toHaveTextContent('1 down');
  });

  it('does not show down count when all endpoints are up', () => {
    mockEndpoints([
      makeEndpoint({ id: 1, name: 'ep1', status: 'up' }),
      makeEndpoint({ id: 2, name: 'ep2', status: 'up' }),
    ]);
    mockStacks([]);

    renderPage();

    expect(screen.queryByTestId('endpoint-down')).not.toBeInTheDocument();
  });

  it('shows correct stack counts in summary bar', () => {
    mockEndpoints([makeEndpoint()]);
    mockStacks([
      makeStack({ id: 1, name: 's1', status: 'active' }),
      makeStack({ id: 2, name: 's2', status: 'active' }),
      makeStack({ id: 3, name: 's3', status: 'inactive' }),
    ]);

    renderPage();

    expect(screen.getByTestId('stack-total')).toHaveTextContent('3 stacks');
    expect(screen.getByTestId('stack-active')).toHaveTextContent('2 active');
    expect(screen.getByTestId('stack-inactive')).toHaveTextContent('1 inactive');
  });

  it('does not show inactive count when all stacks are active', () => {
    mockEndpoints([makeEndpoint()]);
    mockStacks([
      makeStack({ id: 1, name: 's1', status: 'active' }),
    ]);

    renderPage();

    expect(screen.queryByTestId('stack-inactive')).not.toBeInTheDocument();
  });
});

describe('InfrastructurePage — fleet section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useUiStore.setState({ pageViewModes: {} });
    mockStacks([]);
  });

  it('renders endpoint cards in grid view', () => {
    mockEndpoints([
      makeEndpoint({ id: 1, name: 'alpha-env' }),
      makeEndpoint({ id: 2, name: 'beta-env' }),
    ]);

    renderPage();

    expect(screen.getByText('alpha-env')).toBeInTheDocument();
    expect(screen.getByText('beta-env')).toBeInTheDocument();
  });

  it('renders Edge Agent Standard badge for edge endpoints', () => {
    mockEndpoints([
      makeEndpoint({
        id: 1,
        name: 'edge-env',
        isEdge: true,
        edgeMode: 'standard',
        snapshotAge: 30000,
        lastCheckIn: Math.floor(Date.now() / 1000) - 30,
        checkInInterval: 5,
      }),
    ]);

    renderPage();

    expect(screen.getByText(/Edge Agent Standard/)).toBeInTheDocument();
    expect(screen.getByText(/Check-in:/)).toBeInTheDocument();
    expect(screen.getByText(/Snapshot:/)).toBeInTheDocument();
  });

  it('renders Edge Agent Async badge for async endpoints', () => {
    mockEndpoints([
      makeEndpoint({
        id: 2,
        name: 'async-env',
        isEdge: true,
        edgeMode: 'async',
        snapshotAge: 120000,
        lastCheckIn: Math.floor(Date.now() / 1000) - 120,
        checkInInterval: 60,
      }),
    ]);

    renderPage();

    expect(screen.getByText(/Edge Agent Async/)).toBeInTheDocument();
  });

  it('navigates to /workloads?endpoint=<id> when endpoint card is clicked', () => {
    mockEndpoints([makeEndpoint({ id: 7, name: 'click-env' })]);

    renderPage();

    const card = screen.getByRole('button', { name: /click-env/ });
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/workloads?endpoint=7');
  });

  it('auto-switches to table view when endpoint count > 100', () => {
    const endpoints = Array.from({ length: 120 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockEndpoints(endpoints);

    renderPage();

    expect(screen.queryByTestId('grid-pagination')).not.toBeInTheDocument();
    expect(screen.getByTestId('data-table-search')).toBeInTheDocument();
  });

  it('paginates grid view with 30 items per page', () => {
    const endpoints = Array.from({ length: 45 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockEndpoints(endpoints);

    renderPage();

    expect(screen.getByTestId('grid-pagination')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText('env-1')).toBeInTheDocument();
    expect(screen.getByText('env-30')).toBeInTheDocument();
    expect(screen.queryByText('env-31')).not.toBeInTheDocument();
  });

  it('navigates grid pages', () => {
    const endpoints = Array.from({ length: 45 }, (_, i) =>
      makeEndpoint({ id: i + 1, name: `env-${i + 1}` }),
    );
    mockEndpoints(endpoints);

    renderPage();

    const nextBtn = screen.getByTestId('grid-next-page');
    fireEvent.click(nextBtn);

    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText('env-31')).toBeInTheDocument();
    expect(screen.queryByText('env-1')).not.toBeInTheDocument();
  });

  it('fleet table view enables search', () => {
    useUiStore.setState({ pageViewModes: { fleet: 'table' } });
    mockEndpoints([
      makeEndpoint({ id: 1, name: 'alpha-env' }),
      makeEndpoint({ id: 2, name: 'beta-env' }),
    ]);

    renderPage();

    // DataTable search input should be present
    expect(screen.getByTestId('data-table-search')).toBeInTheDocument();
  });
});

describe('InfrastructurePage — stack section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useUiStore.setState({ pageViewModes: {} });
    mockEndpoints([makeEndpoint({ id: 1, name: 'local' })]);
  });

  it('renders stack cards with Discovered badge for compose-label stacks', () => {
    mockStacks([
      makeStack({ id: -12345, name: 'my-compose-app', source: 'compose-label', containerCount: 3, envCount: 0 }),
    ]);

    renderPage();

    expect(screen.getByText('my-compose-app')).toBeInTheDocument();
    expect(screen.getByText('Discovered')).toBeInTheDocument();
  });

  it('renders Portainer stacks with standard ID label', () => {
    mockStacks([
      makeStack({ id: 5, name: 'web-stack', source: 'portainer', envCount: 3 }),
    ]);

    renderPage();

    expect(screen.getByText('web-stack')).toBeInTheDocument();
    expect(screen.getByText('ID: 5')).toBeInTheDocument();
    expect(screen.queryByText('Discovered')).not.toBeInTheDocument();
  });

  it('shows empty state when no stacks exist', () => {
    mockStacks([]);

    renderPage();

    expect(screen.getByText('No stacks or compose projects detected')).toBeInTheDocument();
  });

  it('navigates to workloads when stack card is clicked', () => {
    mockStacks([
      makeStack({ id: 10, name: 'my-stack', endpointId: 1 }),
    ]);

    renderPage();

    const card = screen.getByRole('button', { name: /my-stack/ });
    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/workloads?endpoint=1&stack=my-stack');
  });

  it('stacks table view enables search', () => {
    useUiStore.setState({ pageViewModes: { stacks: 'table' } });
    mockStacks([
      makeStack({ id: 1, name: 'alpha-stack' }),
      makeStack({ id: 2, name: 'beta-stack' }),
    ]);

    renderPage();

    // DataTable search input should be present (one for fleet which is empty, one for stacks)
    const searchInputs = screen.getAllByTestId('data-table-search');
    expect(searchInputs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('InfrastructurePage — shared data hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ pageViewModes: {} });
  });

  it('uses a single useEndpoints call (shared between fleet section and stack enrichment)', () => {
    useUiStore.setState({ pageViewModes: {} });
    mockEndpoints([makeEndpoint({ id: 1, name: 'shared-ep' })]);
    mockStacks([makeStack({ id: 1, name: 'a-stack', endpointId: 1 })]);

    renderPage();

    // Endpoint name appears in fleet card AND as stack endpoint label (shared data)
    const mentions = screen.getAllByText('shared-ep');
    expect(mentions.length).toBeGreaterThanOrEqual(2);
    // useEndpoints and useStacks each called exactly once (no duplicate requests)
    expect(mockUseEndpoints).toHaveBeenCalledTimes(1);
    expect(mockUseStacks).toHaveBeenCalledTimes(1);
  });
});
