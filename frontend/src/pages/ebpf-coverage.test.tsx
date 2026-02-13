import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import EbpfCoveragePage from './ebpf-coverage';

vi.mock('@/hooks/use-ebpf-coverage', () => ({
  useEbpfCoverage: vi.fn(() => ({
    data: {
      coverage: [
        {
          endpoint_id: 1,
          endpoint_name: 'local-docker',
          status: 'deployed',
          exclusion_reason: null,
          deployment_profile: null,
          last_trace_at: '2025-06-01T12:00:00',
          last_verified_at: '2025-06-01T12:05:00',
          created_at: '2025-01-01',
          updated_at: '2025-06-01',
        },
        {
          endpoint_id: 2,
          endpoint_name: 'staging-server',
          status: 'not_deployed',
          exclusion_reason: null,
          deployment_profile: null,
          last_trace_at: null,
          last_verified_at: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        },
        {
          endpoint_id: 3,
          endpoint_name: 'dev-box',
          status: 'excluded',
          exclusion_reason: 'Development only',
          deployment_profile: null,
          last_trace_at: null,
          last_verified_at: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        },
        {
          endpoint_id: 4,
          endpoint_name: 'prod-cluster',
          status: 'failed',
          exclusion_reason: null,
          deployment_profile: null,
          last_trace_at: null,
          last_verified_at: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        },
        {
          endpoint_id: 5,
          endpoint_name: 'remote-unreachable',
          status: 'unreachable',
          exclusion_reason: null,
          deployment_profile: null,
          last_trace_at: null,
          last_verified_at: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        },
        {
          endpoint_id: 6,
          endpoint_name: 'edge-agent-host',
          status: 'incompatible',
          exclusion_reason: null,
          deployment_profile: null,
          last_trace_at: null,
          last_verified_at: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        },
      ],
    },
    isLoading: false,
  })),
  useEbpfCoverageSummary: vi.fn(() => ({
    data: {
      total: 6,
      deployed: 1,
      planned: 0,
      excluded: 1,
      failed: 1,
      unknown: 0,
      not_deployed: 1,
      unreachable: 1,
      incompatible: 1,
      coveragePercent: 17,
    },
    isLoading: false,
  })),
  useSyncCoverage: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useVerifyCoverage: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useDeployBeyla: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useDisableBeyla: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useEnableBeyla: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useRemoveBeyla: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/components/shared/loading-skeleton', () => ({
  SkeletonCard: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EbpfCoveragePage', () => {
  it('renders page header', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByText('eBPF Coverage')).toBeTruthy();
    expect(screen.getByText(/Track Beyla/)).toBeTruthy();
  });

  it('renders summary bar with coverage stats', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const summary = screen.getByTestId('coverage-summary');
    expect(summary).toBeTruthy();
    expect(screen.getByText(/Coverage: 1\/6 endpoints \(17%\)/)).toBeTruthy();
    expect(screen.getByText('Missing: 5')).toBeTruthy();
    expect(screen.getByText('Failed: 1')).toBeTruthy();
  });

  it('renders coverage table with all endpoints', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const table = screen.getByTestId('coverage-table');
    expect(table).toBeTruthy();
    expect(screen.getByText('local-docker')).toBeTruthy();
    expect(screen.getByText('staging-server')).toBeTruthy();
    expect(screen.getByText('dev-box')).toBeTruthy();
    expect(screen.getByText('prod-cluster')).toBeTruthy();
    expect(screen.getByText('remote-unreachable')).toBeTruthy();
    expect(screen.getByText('edge-agent-host')).toBeTruthy();
  });

  it('renders status badges with human-readable labels', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByText('Deployed')).toBeTruthy();
    expect(screen.getByText('Not Deployed')).toBeTruthy();
    expect(screen.getByText('Excluded')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Unreachable')).toBeTruthy();
    expect(screen.getByText('Incompatible')).toBeTruthy();
  });

  it('renders hint text for new statuses', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const hints = screen.getAllByTestId('status-hint');
    expect(hints.length).toBe(3); // not_deployed, unreachable, incompatible
    expect(screen.getByText('Endpoint reachable but no Beyla container found')).toBeTruthy();
    expect(screen.getByText('Could not connect to endpoint to check for Beyla')).toBeTruthy();
    expect(screen.getByText('Endpoint type not supported (ACI, Kubernetes, etc.)')).toBeTruthy();
  });

  it('renders unreachable and incompatible counts in summary', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByText('Unreachable: 1')).toBeTruthy();
    expect(screen.getByText('Incompatible: 1')).toBeTruthy();
  });

  it('renders sync button', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByTestId('sync-btn')).toBeTruthy();
    expect(screen.getByText('Sync Endpoints')).toBeTruthy();
  });

  it('renders verify buttons for each endpoint', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const verifyButtons = screen.getAllByTestId('verify-btn');
    expect(verifyButtons.length).toBe(6);
  });

  it('shows lifecycle action buttons without selecting rows', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getAllByTestId('toggle-btn').length).toBe(6);
    // deploy shown for non-deployed-ish rows, remove shown for deployed/failed rows
    expect(screen.getAllByTestId('deploy-btn').length).toBe(4);
    expect(screen.getAllByTestId('remove-btn').length).toBe(2);
  });

  it('renders table headers', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByText('Endpoint')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Last Trace')).toBeTruthy();
    expect(screen.getByText('Last Verified')).toBeTruthy();
    expect(screen.getByText('Actions')).toBeTruthy();
  });
});
