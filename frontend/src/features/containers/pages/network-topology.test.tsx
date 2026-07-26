import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NetworkTopologyPage, { resolveNetworkMembers } from './network-topology';
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

const autoRefreshCalls: Array<[number, { onTick?: () => void } | undefined]> = [];
vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (defaultInterval: number, opts?: { onTick?: () => void }) => {
    autoRefreshCalls.push([defaultInterval, opts]);
    return { interval: 30, setRefreshInterval: vi.fn(), setInterval: vi.fn() };
  },
}));

// Stub TopologyGraph — it depends on @xyflow/react which is heavy in jsdom and
// adds nothing to the page-level smoke test.
vi.mock('@/features/containers/components/network/topology-graph', () => ({
  TopologyGraph: ({
    containers,
    networks,
    showObservedTraffic,
    observedEdges,
    onNodeClick,
  }: {
    containers: Array<{ id: string; name: string }>;
    networks: Array<{ id: string; name: string }>;
    showObservedTraffic?: boolean;
    observedEdges?: Array<{ source: string; target: string; callCount: number }>;
    onNodeClick?: (nodeId: string) => void;
  }) => (
    <div data-testid="topology-graph">
      <span data-testid="topology-container-count">{containers.length}</span>
      <span data-testid="topology-network-count">{networks.length}</span>
      <span data-testid="topology-show-observed">{String(Boolean(showObservedTraffic))}</span>
      <span data-testid="topology-observed-count">{observedEdges?.length ?? 0}</span>
      {/* Stand-in for clicking a node, so the detail side panel is reachable. */}
      {containers.map((c) => (
        <button key={c.id} onClick={() => onNodeClick?.(`container-${c.id}`)}>
          select {c.name}
        </button>
      ))}
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

  it('renders one h1 matching the navigation label, with the fleet fact as subtitle', () => {
    setHooks({ containers: [makeContainer()], networks: [makeNetwork()] });

    renderPage();

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Topology');

    // The old subtitle was three synonyms for "graph"; the counts are the fact.
    expect(
      screen.queryByText('Interactive network graph visualization'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '1 container across 1 network',
    );
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
    // ...and only once — it used to sit in the filter row as well.
    expect(screen.getAllByText(/2 containers across 2 networks/)).toHaveLength(1);
  });

  it('wires the refresh interval to an actual tick', () => {
    setHooks({ containers: [makeContainer()], networks: [makeNetwork()] });

    renderPage();

    // The hook owns the timer; the page must hand it something to call.
    const opts = autoRefreshCalls.at(-1)?.[1];
    expect(typeof opts?.onTick).toBe('function');
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

  describe('container detail panel — ports', () => {
    function selectContainerWithPorts(ports: unknown[]) {
      // Both hooks must be stubbed here. `clearMocks` resets call history but
      // NOT return values, so stubbing only `useContainers` left this test
      // passing on whatever `useNetworks` value a previously-run test happened
      // to leave behind — and failing when run alone.
      setHooks({ containers: [makeContainer({ ports })], networks: [makeNetwork()] });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'select web' }));
    }

    it('shows the host bind address, so a loopback publish is not read as world-facing', () => {
      selectContainerWithPorts([
        { private: 5432, public: 5432, type: 'tcp', ip: '127.0.0.1' },
      ]);

      expect(screen.getByText('127.0.0.1:5432 → 5432/tcp')).toBeInTheDocument();
    });

    it('keeps the IPv4 and IPv6 bindings of one publish distinguishable', () => {
      // Docker emits these as two entries. Without the bind address the panel
      // printed the same line twice, which reads as a rendering fault.
      selectContainerWithPorts([
        { private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' },
        { private: 80, public: 8080, type: 'tcp', ip: '::' },
      ]);

      expect(screen.getByText('0.0.0.0:8080 → 80/tcp')).toBeInTheDocument();
      expect(screen.getByText('[::]:8080 → 80/tcp')).toBeInTheDocument();
      expect(screen.getAllByText('all interfaces')).toHaveLength(2);
    });

    it('marks an exposed but unpublished port without inventing a bind address', () => {
      selectContainerWithPorts([{ private: 9000, type: 'tcp' }]);

      expect(screen.getByText('9000/tcp')).toBeInTheDocument();
      expect(screen.queryByText('all interfaces')).not.toBeInTheDocument();
    });
  });
});

describe('resolveNetworkMembers', () => {
  const fleet = [
    { id: 'aaaaaaaaaaaa1111', name: 'container-insights-backend' },
    { id: 'bbbbbbbbbbbb2222', name: 'container-insights-redis' },
  ];

  it('names each connected container instead of showing a raw hex id', () => {
    expect(resolveNetworkMembers(['aaaaaaaaaaaa1111'], fleet)).toEqual([
      {
        id: 'aaaaaaaaaaaa1111',
        shortId: 'aaaaaaaaaaaa',
        name: 'container-insights-backend',
      },
    ]);
  });

  it('keeps the short id and invents no name when the container is not in scope', () => {
    const [member] = resolveNetworkMembers(['ffffffffffff9999'], fleet);
    expect(member.name).toBeNull();
    expect(member.shortId).toBe('ffffffffffff');
  });

  it('preserves order and handles an empty fleet', () => {
    const members = resolveNetworkMembers(['bbbbbbbbbbbb2222', 'aaaaaaaaaaaa1111'], []);
    expect(members.map((m) => m.shortId)).toEqual(['bbbbbbbbbbbb', 'aaaaaaaaaaaa']);
    expect(members.every((m) => m.name === null)).toBe(true);
  });
});
