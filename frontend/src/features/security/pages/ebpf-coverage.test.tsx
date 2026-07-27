import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import EbpfCoveragePage, { mergeEndpointCoverage, summarizeCoverage } from './ebpf-coverage';
import type { CoverageRecord } from '@/features/security/hooks/use-ebpf-coverage';

const mockSyncMutate = vi.fn();
const mockVerifyMutate = vi.fn();
const mockDeployMutate = vi.fn();
const mockDisableMutate = vi.fn();
const mockEnableMutate = vi.fn();
const mockRemoveMutate = vi.fn();
const mockDeleteStaleMutate = vi.fn();

const mockUseEbpfCoverage = vi.fn();
const mockUseEndpoints = vi.fn();
let mockRole = 'admin';

vi.mock('@/features/security/hooks/use-ebpf-coverage', () => ({
  useEbpfCoverage: () => mockUseEbpfCoverage(),
  useSyncCoverage: vi.fn(() => ({ mutate: mockSyncMutate, isPending: false })),
  useVerifyCoverage: vi.fn(() => ({ mutate: mockVerifyMutate, isPending: false })),
  useDeployBeyla: vi.fn(() => ({ mutate: mockDeployMutate, isPending: false })),
  useDisableBeyla: vi.fn(() => ({ mutate: mockDisableMutate, isPending: false })),
  useEnableBeyla: vi.fn(() => ({ mutate: mockEnableMutate, isPending: false })),
  useRemoveBeyla: vi.fn(() => ({ mutate: mockRemoveMutate, isPending: false })),
  useDeleteStaleCoverage: vi.fn(() => ({ mutate: mockDeleteStaleMutate, isPending: false })),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => mockUseEndpoints(),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ role: mockRole, username: 'tester', isAuthenticated: true }),
}));

function record(overrides: Partial<CoverageRecord> & { endpoint_id: number; endpoint_name: string }): CoverageRecord {
  return {
    status: 'not_deployed',
    exclusion_reason: null,
    deployment_profile: null,
    last_trace_at: null,
    last_verified_at: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  } as CoverageRecord;
}

const COVERAGE: CoverageRecord[] = [
  record({
    endpoint_id: 1,
    endpoint_name: 'local-docker',
    status: 'deployed',
    last_trace_at: '2025-06-01T12:00:00',
    last_verified_at: '2025-06-01T12:05:00',
  }),
  record({ endpoint_id: 2, endpoint_name: 'staging-server', status: 'not_deployed' }),
  record({ endpoint_id: 3, endpoint_name: 'dev-box', status: 'excluded', exclusion_reason: 'Development only' }),
  record({ endpoint_id: 4, endpoint_name: 'prod-cluster', status: 'failed' }),
  record({ endpoint_id: 5, endpoint_name: 'remote-unreachable', status: 'unreachable' }),
  record({ endpoint_id: 6, endpoint_name: 'edge-agent-host', status: 'incompatible' }),
];

const ENDPOINTS = COVERAGE.map((r) => ({ id: r.endpoint_id, name: r.endpoint_name }));

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

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'admin';
  mockUseEbpfCoverage.mockReturnValue({ data: { coverage: COVERAGE }, isLoading: false });
  mockUseEndpoints.mockReturnValue({ data: ENDPOINTS, isLoading: false });
});

describe('coverage row merge', () => {
  it('keeps one row per live endpoint even with no coverage record', () => {
    const rows = mergeEndpointCoverage([], [{ id: 1, name: 'docker-dev-1' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint_id: 1,
      endpoint_name: 'docker-dev-1',
      status: 'unknown',
      synthetic: true,
    });
  });

  it('prefers the stored record over a synthesised row', () => {
    const rows = mergeEndpointCoverage(
      [record({ endpoint_id: 1, endpoint_name: 'local-docker', status: 'deployed' })],
      [{ id: 1, name: 'local-docker' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('deployed');
    expect(rows[0].synthetic).toBeUndefined();
  });

  it('keeps coverage rows whose endpoint no longer exists', () => {
    const rows = mergeEndpointCoverage(
      [record({ endpoint_id: 9, endpoint_name: 'retired-host', status: 'deployed' })],
      [{ id: 1, name: 'local-docker' }],
    );
    expect(rows.map((r) => r.endpoint_name)).toEqual(['local-docker', 'retired-host']);
  });

  it('counts totals from the rows on screen', () => {
    const totals = summarizeCoverage(mergeEndpointCoverage(COVERAGE, ENDPOINTS));
    expect(totals).toMatchObject({ total: 6, deployed: 1, missing: 5, failed: 1, planned: 0, coveragePercent: 17 });
  });

  it('reports 0% rather than NaN with no endpoints', () => {
    expect(summarizeCoverage([]).coveragePercent).toBe(0);
  });
});

describe('EbpfCoveragePage', () => {
  it('renders the page header through the shared primitive', () => {
    renderWithProviders(<EbpfCoveragePage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('eBPF Coverage');
    // PageHeader owns the scale — this page used to be one step smaller than
    // its 17 siblings.
    expect(heading.className).toContain('sm:text-3xl');
    expect(screen.getByText(/Track Beyla/)).toBeTruthy();
  });

  it('does not add page padding on top of the shell padding', () => {
    const { container } = renderWithProviders(<EbpfCoveragePage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('p-6');
  });

  it('renders summary bar with coverage stats', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByTestId('coverage-summary')).toBeTruthy();
    expect(screen.getByText(/Coverage: 1\/6 endpoints \(17%\)/)).toBeTruthy();
    expect(screen.getByText('Missing: 5')).toBeTruthy();
    expect(screen.getByText('Failed: 1')).toBeTruthy();
  });

  it('suppresses counters that are structurally zero', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.queryByText('Planned: 0')).toBeNull();
    expect(screen.getByText('Unreachable: 1')).toBeTruthy();
    expect(screen.getByText('Incompatible: 1')).toBeTruthy();
  });

  it('shows the live endpoint list before any sync has run', () => {
    mockUseEbpfCoverage.mockReturnValue({ data: { coverage: [] }, isLoading: false });
    mockUseEndpoints.mockReturnValue({ data: [{ id: 1, name: 'docker-dev-1' }], isLoading: false });

    renderWithProviders(<EbpfCoveragePage />);

    expect(screen.getByText('docker-dev-1')).toBeTruthy();
    expect(screen.getByText(/Coverage: 0\/1 endpoints \(0%\)/)).toBeTruthy();
    expect(screen.getByTestId('status-hint')).toHaveTextContent('no coverage record yet');
    // Nothing stale to delete on a row that has no database record.
    expect(screen.queryByTestId('row-overflow-btn')).toBeNull();
  });

  it('drops the whole summary bar when there are no endpoints at all', () => {
    mockUseEbpfCoverage.mockReturnValue({ data: { coverage: [] }, isLoading: false });
    mockUseEndpoints.mockReturnValue({ data: [], isLoading: false });

    renderWithProviders(<EbpfCoveragePage />);

    expect(screen.queryByTestId('coverage-summary')).toBeNull();
    expect(screen.getByText(/No endpoints found. Click "Sync Endpoints"/)).toBeTruthy();
  });

  it('renders coverage table with all endpoints', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByTestId('coverage-table')).toBeTruthy();
    for (const name of ENDPOINTS.map((e) => e.name)) {
      expect(screen.getByText(name)).toBeTruthy();
    }
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

  it('renders sync button', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByTestId('sync-btn')).toBeTruthy();
    expect(screen.getByText('Sync Endpoints')).toBeTruthy();
  });

  it('shows lifecycle action buttons without selecting rows', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getAllByTestId('verify-btn').length).toBe(6);
    expect(screen.getAllByTestId('toggle-btn').length).toBe(6);
    // deploy shown for non-deployed-ish rows, remove shown for deployed/failed rows
    expect(screen.getAllByTestId('deploy-btn').length).toBe(4);
    expect(screen.getAllByTestId('remove-btn').length).toBe(2);
  });

  it('disables every mutation for a viewer, since the backend gates them on admin', () => {
    mockRole = 'viewer';
    renderWithProviders(<EbpfCoveragePage />);

    const verify = screen.getAllByTestId('verify-btn')[0];
    expect(verify).toBeDisabled();
    expect(verify).toHaveAttribute('title', 'Requires the admin role');
    expect(screen.getAllByTestId('toggle-btn')[0]).toBeDisabled();
    expect(screen.getAllByTestId('deploy-btn')[0]).toBeDisabled();
    expect(screen.getAllByTestId('remove-btn')[0]).toBeDisabled();
    expect(screen.getAllByTestId('row-overflow-btn')[0]).toBeDisabled();
    expect(screen.getByTestId('sync-btn')).toBeDisabled();
  });

  it('keeps "Delete stale" out of the action row, behind an overflow menu', () => {
    renderWithProviders(<EbpfCoveragePage />);

    expect(screen.queryByTestId('delete-stale-btn')).toBeNull();

    fireEvent.click(screen.getAllByTestId('row-overflow-btn')[0]);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByTestId('delete-stale-btn')).toHaveTextContent('Delete stale record');
  });

  it('opens delete stale dialog and confirms delete', () => {
    renderWithProviders(<EbpfCoveragePage />);
    fireEvent.click(screen.getAllByTestId('row-overflow-btn')[0]);
    fireEvent.click(screen.getByTestId('delete-stale-btn'));

    expect(screen.getByTestId('ebpf-action-dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm'));

    expect(mockDeleteStaleMutate).toHaveBeenCalledWith(1);
  });

  it('renders table headers', () => {
    renderWithProviders(<EbpfCoveragePage />);
    expect(screen.getByText('Endpoint')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Last Trace')).toBeTruthy();
    expect(screen.getByText('Last Verified')).toBeTruthy();
    expect(screen.getByText('Actions')).toBeTruthy();
  });

  it('renders the confirmation as an accessible modal dialog (#1539)', () => {
    renderWithProviders(<EbpfCoveragePage />);
    fireEvent.click(screen.getAllByTestId('row-overflow-btn')[0]);
    fireEvent.click(screen.getByTestId('delete-stale-btn'));

    // Radix wires the title as the dialog's accessible name.
    const dialog = screen.getByRole('dialog', { name: 'Delete stale endpoint local-docker?' });
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId('ebpf-action-dialog')).toBeTruthy();
  });

  it('closes the dialog on Escape without running the action (#1539)', async () => {
    renderWithProviders(<EbpfCoveragePage />);
    fireEvent.click(screen.getAllByTestId('row-overflow-btn')[0]);
    fireEvent.click(screen.getByTestId('delete-stale-btn'));
    expect(screen.getByTestId('ebpf-action-dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('ebpf-action-dialog')).toBeNull();
    });
    expect(mockDeleteStaleMutate).not.toHaveBeenCalled();
  });

  it('renders the OTLP endpoint input inside the deploy dialog and deploys with it', () => {
    renderWithProviders(<EbpfCoveragePage />);
    fireEvent.click(screen.getAllByTestId('deploy-btn')[0]);

    const dialog = screen.getByTestId('ebpf-action-dialog');
    const input = within(dialog).getByTestId('deploy-otlp-input');
    fireEvent.change(input, { target: { value: '192.168.1.10' } });
    fireEvent.click(within(dialog).getByText('Confirm'));

    expect(mockDeployMutate).toHaveBeenCalledWith({
      endpointId: 2,
      otlpEndpoint: '192.168.1.10',
    });
  });
});
