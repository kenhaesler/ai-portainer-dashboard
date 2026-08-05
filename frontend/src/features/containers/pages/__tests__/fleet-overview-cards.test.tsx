import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import InfrastructurePage from '../fleet-overview';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(),
}));

vi.mock('@/features/containers/hooks/use-stacks', () => ({
  useStacks: vi.fn(),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({
    interval: 30,
    setRefreshInterval: vi.fn(),
    setInterval: vi.fn(),
    enabled: true,
  }),
}));

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    request: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useStacks } from '@/features/containers/hooks/use-stacks';
import type { Endpoint } from '@/features/containers/hooks/use-endpoints';
import type { Stack } from '@/features/containers/hooks/use-stacks';
import { useUiStore } from '@/stores/ui-store';
import { snapshotSourceFor } from '@/test/endpoint-fixture';

const mockUseEndpoints = vi.mocked(useEndpoints);
const mockUseStacks = vi.mocked(useStacks);

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  const base: Omit<Endpoint, 'snapshotSource'> = {
    id: 1,
    name: 'test-endpoint',
    type: 1,
    url: 'tcp://10.0.0.1:9001',
    status: 'up',
    containersRunning: 3,
    containersStopped: 2,
    totalContainers: 5,
    stackCount: 2,
    totalCpu: 4,
    totalMemory: 8589934592, // 8.0 GB
    isEdge: false,
    edgeMode: null,
    snapshotAge: null,
    checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    ...overrides,
  };
  return { ...base, snapshotSource: overrides.snapshotSource ?? snapshotSourceFor(base) };
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
    createdAt: 1700000000,
    updatedAt: 1700000000,
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

function renderPage({ initialRoute = '/infrastructure' }: { initialRoute?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <InfrastructurePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EndpointCard — compact 3-row layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useUiStore.setState({ pageViewModes: {} });
    mockStacks([]);
  });

  it('renders name and ID on row 1', () => {
    mockEndpoints([makeEndpoint({ id: 42, name: 'prod-server' })]);

    renderPage();

    expect(screen.getByText('prod-server')).toBeInTheDocument();
    expect(screen.getByText('(ID: 42)')).toBeInTheDocument();
  });

  it('renders type tag and status badge on row 2 for non-edge endpoint', () => {
    mockEndpoints([makeEndpoint({ type: 1, status: 'up', isEdge: false })]);

    renderPage();

    // Type label for Docker (type 1)
    expect(screen.getByText('Docker')).toBeInTheDocument();
  });

  it('renders stats on row 3 (containers, stacks, CPU, memory)', () => {
    mockEndpoints([
      makeEndpoint({
        totalContainers: 5,
        containersRunning: 3,
        stackCount: 2,
        totalCpu: 4,
        totalMemory: 8589934592, // 8.0 GB
      }),
    ]);

    renderPage();

    // Stats row: total containers and running count
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/3 running/)).toBeInTheDocument();
    // Stacks count — no discovered compose projects on this endpoint
    expect(screen.getByText('2 stacks')).toBeInTheDocument();
    // Capacity carries its unit; "10 CPU / 7.8 GB" named no quantity.
    expect(screen.getByText('4 CPU cores')).toBeInTheDocument();
    expect(screen.getByText('8.0 GB memory')).toBeInTheDocument();
  });

  it('separates Portainer-managed stacks from discovered compose projects', () => {
    // The reported contradiction: the card said "0 stacks" for an endpoint
    // whose Stack Overview tab listed five.
    mockEndpoints([makeEndpoint({ id: 3, name: 'docker-dev-1', stackCount: 0 })]);
    mockStacks([
      makeStack({ id: -1, name: 'a', source: 'compose-label', endpointId: 3 }),
      makeStack({ id: -2, name: 'b', source: 'compose-label', endpointId: 3 }),
      makeStack({ id: -3, name: 'c', source: 'compose-label', endpointId: 3 }),
    ]);

    renderPage();

    expect(screen.getByText('0 managed · 3 discovered')).toBeInTheDocument();
    expect(screen.queryByText('0 stacks')).not.toBeInTheDocument();
  });

  it('offers the "View stacks" link for discovered-only endpoints', () => {
    // Gated on stackCount alone, this link vanished exactly when the endpoint
    // had compose projects but no Portainer-managed stack.
    mockEndpoints([makeEndpoint({ id: 3, name: 'docker-dev-1', stackCount: 0 })]);
    mockStacks([
      makeStack({ id: -1, name: 'a', source: 'compose-label', endpointId: 3 }),
      makeStack({ id: -2, name: 'b', source: 'compose-label', endpointId: 3 }),
    ]);

    renderPage();

    const link = screen.getByTestId('view-stacks-link');
    expect(link).toHaveTextContent('View 2 stacks');

    fireEvent.click(link);
    expect(screen.getByTestId('clear-stack-filter')).toBeInTheDocument();
  });

  it('renders Edge Agent badge on row 2 for edge endpoint', () => {
    mockEndpoints([
      makeEndpoint({
        isEdge: true,
        edgeMode: 'standard',
        snapshotAge: 30000,
        lastCheckIn: Math.floor(Date.now() / 1000) - 30,
        checkInInterval: 5,
        agentVersion: '2.20.0',
      }),
    ]);

    renderPage();

    expect(screen.getByText(/Edge Agent Standard/)).toBeInTheDocument();
    expect(screen.getByText('v2.20.0')).toBeInTheDocument();
  });

  it('renders Edge Agent Async badge for async edge endpoints', () => {
    mockEndpoints([
      makeEndpoint({
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

  it('shows check-in and snapshot age for edge endpoints', () => {
    mockEndpoints([
      makeEndpoint({
        isEdge: true,
        edgeMode: 'standard',
        snapshotAge: 30000,
        lastCheckIn: Math.floor(Date.now() / 1000) - 30,
        checkInInterval: 5,
      }),
    ]);

    renderPage();

    expect(screen.getByText(/Check-in:/)).toBeInTheDocument();
    expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  });

  it('"View stacks" link works and calls onViewStacks', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'ep-with-stacks', stackCount: 3 })]);
    mockStacks([
      makeStack({ id: 1, endpointId: 1 }),
      makeStack({ id: 2, endpointId: 1 }),
      makeStack({ id: 3, endpointId: 1 }),
    ]);

    renderPage();

    const viewLink = screen.getByTestId('view-stacks-link');
    expect(viewLink).toBeInTheDocument();
    expect(viewLink).toHaveTextContent('View 3 stacks');

    fireEvent.click(viewLink);

    // Should filter stacks section
    expect(screen.getByTestId('clear-stack-filter')).toBeInTheDocument();
  });

  it('uses singular "stack" in the view-stacks link when stackCount is 1', () => {
    mockEndpoints([makeEndpoint({ stackCount: 1 })]);
    mockStacks([makeStack({ endpointId: 1 })]);

    renderPage();

    // The view-stacks link is where the singular form is applied.
    const viewLink = screen.getByTestId('view-stacks-link');
    expect(viewLink).toHaveTextContent('View 1 stack');
  });

  it('does not nest the "View stacks" button inside another button (#1547)', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'ep-with-stacks', stackCount: 2 })]);
    mockStacks([
      makeStack({ id: 1, endpointId: 1 }),
      makeStack({ id: 2, endpointId: 1 }),
    ]);

    renderPage();

    const viewLink = screen.getByTestId('view-stacks-link');
    expect(viewLink.tagName).toBe('BUTTON');
    // Invalid-HTML regression guard: no button ancestor
    expect(viewLink.parentElement?.closest('button')).toBeNull();
  });

  it('keeps both card actions keyboard-accessible (#1547)', () => {
    mockEndpoints([makeEndpoint({ id: 9, name: 'kbd-env', stackCount: 1 })]);
    mockStacks([makeStack({ id: 1, endpointId: 9 })]);

    renderPage();

    // The endpoint name is a real button that opens the endpoint
    const nameButton = screen.getByRole('button', { name: 'kbd-env' });
    fireEvent.click(nameButton);
    expect(mockNavigate).toHaveBeenCalledWith('/workloads?endpoint=9');

    // The view-stacks action stays an independent button
    const viewLink = screen.getByTestId('view-stacks-link');
    fireEvent.click(viewLink);
    expect(screen.getByTestId('clear-stack-filter')).toBeInTheDocument();
  });
});

describe('StackCard — compact 3-row layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useUiStore.setState({ pageViewModes: {} });
  });

  it('renders stack name and ID on row 1', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([makeStack({ id: 5, name: 'web-stack', endpointId: 1 })]);

    renderPage({ initialRoute: '/infrastructure?tab=stacks' });

    expect(screen.getByText('web-stack')).toBeInTheDocument();
    expect(screen.getByText('(ID: 5)')).toBeInTheDocument();
  });

  it('renders type tag and status badge on row 2', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([makeStack({ type: 2, status: 'active', endpointId: 1 })]);

    renderPage({ initialRoute: '/infrastructure?tab=stacks' });

    // Type tag for Compose (type 2)
    expect(screen.getByText('Compose')).toBeInTheDocument();
  });

  it('renders metadata on row 3 (endpoint name, env vars)', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'prod-env' })]);
    mockStacks([
      makeStack({
        endpointId: 1,
        envCount: 3,
        createdAt: 1700000000,
        source: 'portainer',
      }),
    ]);

    renderPage({ initialRoute: '/infrastructure?tab=stacks' });

    // Endpoint name in metadata row
    expect(screen.getByText(/prod-env/)).toBeInTheDocument();

    // Env vars count
    expect(screen.getByText('3 env vars')).toBeInTheDocument();
  });

  it('shows Discovered badge instead of ID for inferred stacks in a mixed list', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([
      makeStack({
        id: -12345,
        name: 'compose-app',
        source: 'compose-label',
        containerCount: 3,
        envCount: 0,
        endpointId: 1,
      }),
      makeStack({ id: 9, name: 'managed-app', source: 'portainer', envCount: 1, endpointId: 1 }),
    ]);

    renderPage({ initialRoute: '/infrastructure?tab=stacks' });

    expect(screen.getByText('compose-app')).toBeInTheDocument();
    expect(screen.getAllByText('Discovered')).toHaveLength(1);
    // Should show containers instead of env vars for inferred stacks
    expect(screen.getByText('3 containers')).toBeInTheDocument();
  });

  it('drops the Discovered badge when the whole list is inferred', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([
      makeStack({ id: -1, name: 'compose-app', source: 'compose-label', containerCount: 3, envCount: 0, endpointId: 1 }),
      makeStack({ id: -2, name: 'compose-two', source: 'compose-label', containerCount: 1, envCount: 0, endpointId: 1 }),
    ]);

    renderPage({ initialRoute: '/infrastructure?tab=stacks' });

    expect(screen.queryByText('Discovered')).not.toBeInTheDocument();
    // Singular form for a one-container project (#'1 containers' regression).
    expect(screen.getByText('1 container')).toBeInTheDocument();
  });

  it('does not show Discovered badge for portainer stacks', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([
      makeStack({ id: 5, name: 'normal-stack', source: 'portainer', endpointId: 1 }),
    ]);

    renderPage({ initialRoute: '/infrastructure?tab=stacks' });

    expect(screen.getByText('(ID: 5)')).toBeInTheDocument();
    expect(screen.queryByText('Discovered')).not.toBeInTheDocument();
  });
});
