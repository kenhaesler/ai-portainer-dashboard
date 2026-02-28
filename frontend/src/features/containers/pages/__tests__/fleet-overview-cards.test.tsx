import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InfrastructurePage from '../fleet-overview';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(),
}));

vi.mock('@/features/containers/hooks/use-stacks', () => ({
  useStacks: vi.fn(),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
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

const mockUseEndpoints = vi.mocked(useEndpoints);
const mockUseStacks = vi.mocked(useStacks);

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 1,
    name: 'test-endpoint',
    type: 1,
    url: 'tcp://10.0.0.1:9001',
    status: 'up',
    containersRunning: 3,
    containersStopped: 2,
    containersHealthy: 3,
    containersUnhealthy: 0,
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
    expect(screen.getByText('ID: 42')).toBeInTheDocument();
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

    // Stats row: containers with running count
    expect(screen.getByText(/5 containers/)).toBeInTheDocument();
    expect(screen.getByText(/3 running/)).toBeInTheDocument();
    // Stacks count
    expect(screen.getByText('2 stacks')).toBeInTheDocument();
    // CPU
    expect(screen.getByText(/4 CPU/)).toBeInTheDocument();
    // Memory
    expect(screen.getByText('8.0 GB')).toBeInTheDocument();
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
    expect(screen.getByText(/Snapshot:/)).toBeInTheDocument();
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

  it('uses singular "stack" when stackCount is 1', () => {
    mockEndpoints([makeEndpoint({ stackCount: 1 })]);
    mockStacks([makeStack({ endpointId: 1 })]);

    renderPage();

    // Row 3 stats (also appears in summary bar, so use getAllByText)
    const stackTexts = screen.getAllByText('1 stack');
    expect(stackTexts.length).toBeGreaterThanOrEqual(1);

    // View stacks link
    const viewLink = screen.getByTestId('view-stacks-link');
    expect(viewLink).toHaveTextContent('View 1 stack');
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

    renderPage();

    expect(screen.getByText('web-stack')).toBeInTheDocument();
    expect(screen.getByText('ID: 5')).toBeInTheDocument();
  });

  it('renders type tag and status badge on row 2', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([makeStack({ type: 2, status: 'active', endpointId: 1 })]);

    renderPage();

    // Type tag for Compose (type 2)
    expect(screen.getByText('Compose')).toBeInTheDocument();
  });

  it('renders metadata on row 3 (endpoint name, env vars, created date)', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'prod-env' })]);
    mockStacks([
      makeStack({
        endpointId: 1,
        envCount: 3,
        createdAt: 1700000000,
        source: 'portainer',
      }),
    ]);

    renderPage();

    // Endpoint name in metadata row
    const mentions = screen.getAllByText('prod-env');
    expect(mentions.length).toBeGreaterThanOrEqual(2); // fleet card + stack metadata

    // Env vars count
    expect(screen.getByText('3 env vars')).toBeInTheDocument();

    // Created date
    expect(screen.getByText(/Created/)).toBeInTheDocument();
  });

  it('shows Discovered badge instead of ID for inferred stacks', () => {
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
    ]);

    renderPage();

    expect(screen.getByText('compose-app')).toBeInTheDocument();
    expect(screen.getByText('Discovered')).toBeInTheDocument();
    // Should show containers instead of env vars for inferred stacks
    expect(screen.getByText('3 containers')).toBeInTheDocument();
  });

  it('does not show Discovered badge for portainer stacks', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'local-env' })]);
    mockStacks([
      makeStack({ id: 5, name: 'normal-stack', source: 'portainer', endpointId: 1 }),
    ]);

    renderPage();

    expect(screen.getByText('ID: 5')).toBeInTheDocument();
    expect(screen.queryByText('Discovered')).not.toBeInTheDocument();
  });
});
