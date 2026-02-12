import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  useUpdateCoverageStatus: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useVerifyCoverage: vi.fn(() => ({
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

  it('renders deploy/remove and enable/disable action buttons', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const deployRemoveButtons = screen.getAllByTestId('deploy-remove-btn');
    const enableDisableButtons = screen.getAllByTestId('enable-disable-btn');

    expect(deployRemoveButtons.length).toBe(6);
    expect(enableDisableButtons.length).toBe(6);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Deploy' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Disable' }).length).toBeGreaterThan(0);
  });

  it('wires deploy/remove and enable/disable actions to coverage update mutation', async () => {
    const { useUpdateCoverageStatus } = await import('@/hooks/use-ebpf-coverage');
    const mutate = vi.fn();
    vi.mocked(useUpdateCoverageStatus).mockReturnValueOnce({ mutate, isPending: false });

    renderWithProviders(<EbpfCoveragePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getAllByTestId('enable-disable-btn')[0]);

    expect(mutate).toHaveBeenCalledWith({ endpointId: 1, status: 'not_deployed' });
    expect(mutate).toHaveBeenCalledWith({
      endpointId: 1,
      status: 'excluded',
      reason: 'Manually disabled from coverage page',
    });
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
