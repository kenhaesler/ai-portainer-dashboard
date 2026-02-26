import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

import { toast } from 'sonner';
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

describe('InfrastructurePage — cross-section filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useUiStore.setState({ pageViewModes: {} });
  });

  it('renders "View stacks" button when endpoint has stacks', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'ep-with-stacks', stackCount: 2 })]);
    mockStacks([makeStack({ id: 1, endpointId: 1 }), makeStack({ id: 2, endpointId: 1 })]);

    renderPage();

    expect(screen.getByTestId('view-stacks-link')).toBeInTheDocument();
  });

  it('does not render "View stacks" button when endpoint has no stacks', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'ep-no-stacks', stackCount: 0 })]);
    mockStacks([]);

    renderPage();

    expect(screen.queryByTestId('view-stacks-link')).not.toBeInTheDocument();
  });

  it('clicking "View stacks" filters the stacks section to that endpoint', () => {
    mockEndpoints([
      makeEndpoint({ id: 1, name: 'ep1', stackCount: 1 }),
      makeEndpoint({ id: 2, name: 'ep2', stackCount: 1 }),
    ]);
    mockStacks([
      makeStack({ id: 1, name: 'stack-for-ep1', endpointId: 1 }),
      makeStack({ id: 2, name: 'stack-for-ep2', endpointId: 2 }),
    ]);

    renderPage();

    // Both stacks visible initially
    expect(screen.getByText('stack-for-ep1')).toBeInTheDocument();
    expect(screen.getByText('stack-for-ep2')).toBeInTheDocument();

    // Click "View stacks" on the first endpoint (ep1)
    const viewButtons = screen.getAllByTestId('view-stacks-link');
    fireEvent.click(viewButtons[0]);

    // Only ep1's stack is shown
    expect(screen.getByText('stack-for-ep1')).toBeInTheDocument();
    expect(screen.queryByText('stack-for-ep2')).not.toBeInTheDocument();

    // Filter chip appears
    expect(screen.getByTestId('clear-stack-filter')).toBeInTheDocument();
  });

  it('clicking the clear filter chip restores all stacks', () => {
    mockEndpoints([
      makeEndpoint({ id: 1, name: 'ep1', stackCount: 1 }),
      makeEndpoint({ id: 2, name: 'ep2', stackCount: 1 }),
    ]);
    mockStacks([
      makeStack({ id: 1, name: 'stack-for-ep1', endpointId: 1 }),
      makeStack({ id: 2, name: 'stack-for-ep2', endpointId: 2 }),
    ]);

    renderPage();

    // Apply filter
    const viewButtons = screen.getAllByTestId('view-stacks-link');
    fireEvent.click(viewButtons[0]);
    expect(screen.queryByText('stack-for-ep2')).not.toBeInTheDocument();

    // Clear filter
    fireEvent.click(screen.getByTestId('clear-stack-filter'));

    // Both stacks visible again
    expect(screen.getByText('stack-for-ep1')).toBeInTheDocument();
    expect(screen.getByText('stack-for-ep2')).toBeInTheDocument();
    expect(screen.queryByTestId('clear-stack-filter')).not.toBeInTheDocument();
  });

  it('shows filtered empty state when selected endpoint has no matching stacks', () => {
    // Endpoint reports stackCount > 0 but stacks hook has none for it
    mockEndpoints([makeEndpoint({ id: 1, name: 'ep1', stackCount: 1 })]);
    mockStacks([]);

    renderPage();

    fireEvent.click(screen.getByTestId('view-stacks-link'));

    expect(screen.getByText('No stacks for this endpoint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all stacks' })).toBeInTheDocument();
  });

  it('"Show all stacks" in the filtered empty state clears the filter', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'ep1', stackCount: 1 })]);
    mockStacks([]);

    renderPage();

    fireEvent.click(screen.getByTestId('view-stacks-link'));
    expect(screen.getByText('No stacks for this endpoint')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all stacks' }));

    // Back to normal empty state
    expect(screen.getByText('No stacks or compose projects detected')).toBeInTheDocument();
    expect(screen.queryByTestId('clear-stack-filter')).not.toBeInTheDocument();
  });
});

describe('InfrastructurePage — forceRefresh error toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ pageViewModes: {} });
  });

  it('shows error toast when endpoint refetch fails during force refresh', async () => {
    const rejectedRefetch = vi.fn().mockRejectedValue(new Error('Network error'));
    mockUseEndpoints.mockReturnValue({
      data: [makeEndpoint()],
      isLoading: false,
      isError: false,
      error: null,
      refetch: rejectedRefetch,
      isFetching: false,
    } as any);
    mockStacks([makeStack()]);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Bypass cache/i }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to refresh endpoints');
    });
  });

  it('shows error toast when stacks refetch fails during force refresh', async () => {
    const rejectedRefetch = vi.fn().mockRejectedValue(new Error('Network error'));
    mockEndpoints([makeEndpoint()]);
    mockUseStacks.mockReturnValue({
      data: [makeStack()],
      isLoading: false,
      isError: false,
      error: null,
      refetch: rejectedRefetch,
      isFetching: false,
    } as any);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Bypass cache/i }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to refresh stacks');
    });
  });

  it('does not show error toast when both refetches succeed', async () => {
    mockEndpoints([makeEndpoint()]);
    mockStacks([makeStack()]);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Bypass cache/i }));

    // Wait a tick for async resolution
    await waitFor(() => {
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    });
  });
});
