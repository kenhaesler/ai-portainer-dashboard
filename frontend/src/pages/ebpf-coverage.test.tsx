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
          status: 'planned',
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
      ],
    },
    isLoading: false,
  })),
  useEbpfCoverageSummary: vi.fn(() => ({
    data: {
      total: 4,
      deployed: 1,
      planned: 1,
      excluded: 1,
      failed: 1,
      unknown: 0,
      coveragePercent: 25,
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
    expect(screen.getByText(/Coverage: 1\/4 endpoints \(25%\)/)).toBeTruthy();
    expect(screen.getByText('Missing: 3')).toBeTruthy();
    expect(screen.getByText('Failed: 1')).toBeTruthy();
  });

  it('renders coverage table with endpoints', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const table = screen.getByTestId('coverage-table');
    expect(table).toBeTruthy();
    expect(screen.getByText('local-docker')).toBeTruthy();
    expect(screen.getByText('staging-server')).toBeTruthy();
    expect(screen.getByText('dev-box')).toBeTruthy();
    expect(screen.getByText('prod-cluster')).toBeTruthy();
  });

  it('renders status badges for each endpoint', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByText('deployed')).toBeTruthy();
    expect(screen.getByText('planned')).toBeTruthy();
    expect(screen.getByText('excluded')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('renders sync button', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByTestId('sync-btn')).toBeTruthy();
    expect(screen.getByText('Sync Endpoints')).toBeTruthy();
  });

  it('renders verify buttons for each endpoint', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const verifyButtons = screen.getAllByTestId('verify-btn');
    expect(verifyButtons.length).toBe(4);
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
