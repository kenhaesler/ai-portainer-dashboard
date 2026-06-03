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

vi.mock('@/features/observability/hooks/use-service-map', () => ({
  useServiceMap: vi.fn(),
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
    showObservedTraffic,
    observedEdges,
  }: {
    containers: Array<{ id: string; name: string }>;
    networks: Array<{ id: string; name: string }>;
    showObservedTraffic?: boolean;
    observedEdges?: Array<{ source: string; target: string; callCount: number }>;
  }) => (
    <div data-testid="topology-graph">
      <span data-testid="topology-container-count">{containers.length}</span>
      <span data-testid="topology-network-count">{networks.length}</span>
      <span data-testid="topology-show-observed">{String(Boolean(showObservedTraffic))}</span>
      <span data-testid="topology-observed-count">{observedEdges?.length ?? 0}</span>
    </div>
  ),
}));

import { useContainers } from '@/features/containers/hooks/use-containers';
import { useNetworks } from '@/features/containers/hooks/use-networks';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useNetworkRates } from '@/features/observability/hooks/use-metrics';
import { useServiceMap } from '@/features/observability/hooks/use-service-map';

const mockUseContainers = vi.mocked(useContainers);
const mockUseNetworks = vi.mocked(useNetworks);
const mockUseEndpoints = vi.mocked(useEndpoints);
const mockUseNetworkRates = vi.mocked(useNetworkRates);
const mockUseServiceMap = vi.mocked(useServiceMap);

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
    mockUseServiceMap.mockReturnValue({ data: undefined } as any);
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
    // SkeletonChart renders a status node with aria-label="Loading"
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

  describe('RPC overlay (#1233)', () => {
    it('defaults observed-traffic overlay OFF when service-map has no edges', () => {
      setHooks({ containers: [makeContainer()], networks: [makeNetwork()] });
      mockUseServiceMap.mockReturnValue({
        data: { nodes: [], edges: [] },
      } as any);

      renderPage();

      expect(screen.getByTestId('topology-show-observed')).toHaveTextContent('false');
      expect(screen.getByTestId('topology-observed-count')).toHaveTextContent('0');
      const toggle = screen.getByLabelText('Toggle observed traffic overlay') as HTMLInputElement;
      expect(toggle.disabled).toBe(true);
    });

    it('defaults observed-traffic overlay ON when service-map returns edges', async () => {
      setHooks({
        containers: [
          makeContainer({ id: 'c1', name: 'web' }),
          makeContainer({ id: 'c2', name: 'api' }),
        ],
        networks: [makeNetwork()],
      });
      mockUseServiceMap.mockReturnValue({
        data: {
          nodes: [
            { id: 'web', name: 'web', errorRate: 0 },
            { id: 'api', name: 'api', errorRate: 0.02 },
          ],
          edges: [
            { source: 'web', target: 'api', callCount: 100, avgDuration: 50 },
          ],
        },
      } as any);

      renderPage();

      const toggle = screen.getByLabelText('Toggle observed traffic overlay') as HTMLInputElement;
      expect(toggle.disabled).toBe(false);
      // Wait one tick for the useEffect to flip default-on.
      await screen.findByText(/Observed traffic/);
      expect(toggle.checked).toBe(true);
      expect(screen.getByTestId('topology-observed-count')).toHaveTextContent('1');
    });

    it('passes the merged observed edges to TopologyGraph', () => {
      setHooks({
        containers: [
          makeContainer({ id: 'c1', name: 'web' }),
          makeContainer({ id: 'c2', name: 'api' }),
        ],
        networks: [makeNetwork()],
      });
      mockUseServiceMap.mockReturnValue({
        data: {
          nodes: [
            { id: 'web', name: 'web', errorRate: 0 },
            { id: 'api', name: 'api', errorRate: 0.07 },
          ],
          edges: [
            { source: 'web', target: 'api', callCount: 100, avgDuration: 50 },
            { source: 'api', target: 'web', callCount: 25, avgDuration: 5 },
          ],
        },
      } as any);

      renderPage();
      expect(screen.getByTestId('topology-observed-count')).toHaveTextContent('2');
    });
  });

  // ── Empty / unavailable fleet (#1420) ──────────────────────────────────────

  describe('empty/unavailable fleet (#1420)', () => {
    it('renders without throwing when endpoints, containers and networks return empty arrays', () => {
      mockUseEndpoints.mockReturnValue({ data: [], isLoading: false } as any);
      setHooks({ containers: [], networks: [] });

      expect(() => renderPage()).not.toThrow();
      expect(screen.getByRole('heading', { name: /Network Topology/i })).toBeInTheDocument();
    });

    it('renders without throwing when containers and networks queries return errors', () => {
      mockUseEndpoints.mockReturnValue({ data: undefined, isLoading: false } as any);
      mockUseContainers.mockReturnValue({
        data: undefined,
        isLoading: false,
        isPending: false,
        isError: true,
        isFetching: false,
        refetch: vi.fn(),
      } as any);
      mockUseNetworks.mockReturnValue({
        data: undefined,
        isLoading: false,
        isPending: false,
        isError: true,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      expect(() => renderPage()).not.toThrow();
      // The page shows an error affordance in this case
      expect(screen.getByText(/Failed to load containers or networks/i)).toBeInTheDocument();
    });
  });
});
