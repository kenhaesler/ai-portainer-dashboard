import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NetworkTopologyPage from './network-topology';
import { useUiStore } from '@/stores/ui-store';

// Mock data hooks at the boundary
vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: vi.fn(),
}));

vi.mock('@/features/containers/hooks/use-networks', () => ({
  useNetworks: vi.fn(),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(),
}));

vi.mock('@/features/observability/hooks/use-metrics', () => ({
  useNetworkRates: vi.fn(),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
}));

// Stub TopologyGraph — it depends on @xyflow/react which is heavy in jsdom and
// adds nothing to the page-level smoke test.
vi.mock('@/features/containers/components/network/topology-graph', () => ({
  TopologyGraph: ({
    containers,
    networks,
  }: {
    containers: Array<{ id: string; name: string }>;
    networks: Array<{ id: string; name: string }>;
  }) => (
    <div data-testid="topology-graph">
      <span data-testid="topology-container-count">{containers.length}</span>
      <span data-testid="topology-network-count">{networks.length}</span>
    </div>
  ),
}));

import { useContainers } from '@/features/containers/hooks/use-containers';
import { useNetworks } from '@/features/containers/hooks/use-networks';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useNetworkRates } from '@/features/observability/hooks/use-metrics';

const mockUseContainers = vi.mocked(useContainers);
const mockUseNetworks = vi.mocked(useNetworks);
const mockUseEndpoints = vi.mocked(useEndpoints);
const mockUseNetworkRates = vi.mocked(useNetworkRates);

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'web',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 minutes',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 1700000000,
    labels: {},
    networks: ['bridge'],
    networkIPs: { bridge: '172.17.0.2' },
    ...overrides,
  };
}

function makeNetwork(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    name: 'bridge',
    driver: 'bridge',
    scope: 'local',
    subnet: '172.17.0.0/16',
    gateway: '172.17.0.1',
    endpointId: 1,
    endpointName: 'local',
    containers: ['c1'],
    ...overrides,
  };
}

function setHooks({
  containers,
  networks,
  containersState = {},
  networksState = {},
}: {
  containers?: ReturnType<typeof makeContainer>[];
  networks?: ReturnType<typeof makeNetwork>[];
  containersState?: Record<string, unknown>;
  networksState?: Record<string, unknown>;
}) {
  mockUseContainers.mockReturnValue({
    data: containers,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...containersState,
  } as any);

  mockUseNetworks.mockReturnValue({
    data: networks,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...networksState,
  } as any);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NetworkTopologyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NetworkTopologyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      potatoMode: false,
      collapsedGroups: {},
      pageViewModes: {},
    });

    mockUseEndpoints.mockReturnValue({
      data: [
        { id: 1, name: 'local' },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    mockUseNetworkRates.mockReturnValue({ data: { rates: {} } } as any);
  });

  it('renders the page heading and description', () => {
    setHooks({ containers: [makeContainer()], networks: [makeNetwork()] });

    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Network Topology' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Interactive network graph visualization'),
    ).toBeInTheDocument();
  });

  it('renders the topology graph with container and network counts', () => {
    setHooks({
      containers: [
        makeContainer({ id: 'c1', name: 'web' }),
        makeContainer({ id: 'c2', name: 'api' }),
      ],
      networks: [makeNetwork({ id: 'n1', name: 'bridge' })],
    });

    renderPage();

    expect(screen.getByTestId('topology-graph')).toBeInTheDocument();
    expect(screen.getByTestId('topology-container-count')).toHaveTextContent('2');
    expect(screen.getByTestId('topology-network-count')).toHaveTextContent('1');
  });

  it('shows the count summary text', () => {
    setHooks({
      containers: [makeContainer({ id: 'c1' }), makeContainer({ id: 'c2' })],
      networks: [makeNetwork({ id: 'n1' }), makeNetwork({ id: 'n2' })],
    });

    renderPage();

    expect(screen.getByText(/2 containers/)).toBeInTheDocument();
    expect(screen.getByText(/2 networks/)).toBeInTheDocument();
  });

  it('shows the loading skeleton while data is loading', () => {
    setHooks({
      containers: undefined,
      networks: undefined,
      containersState: { isLoading: true, isPending: true },
      networksState: { isLoading: true, isPending: true },
    });

    renderPage();

    // Topology graph should not render in the loading state
    expect(screen.queryByTestId('topology-graph')).not.toBeInTheDocument();
    // SkeletonCard renders a status node with aria-label="Loading"
    expect(
      screen.getByRole('status', { name: 'Loading' }),
    ).toBeInTheDocument();
  });

  it('renders an error state when containers fetch fails', () => {
    setHooks({
      containers: undefined,
      networks: [makeNetwork()],
      containersState: { isError: true },
    });

    renderPage();

    expect(screen.getByText('Error loading topology')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('topology-graph')).not.toBeInTheDocument();
  });

  it('renders an empty topology graph when containers and networks are empty arrays', () => {
    setHooks({ containers: [], networks: [] });

    renderPage();

    // No error, no skeleton — just a graph with zero nodes
    expect(screen.queryByText('Error loading topology')).not.toBeInTheDocument();
    expect(screen.getByTestId('topology-graph')).toBeInTheDocument();
    expect(screen.getByTestId('topology-container-count')).toHaveTextContent('0');
    expect(screen.getByTestId('topology-network-count')).toHaveTextContent('0');
  });
});
