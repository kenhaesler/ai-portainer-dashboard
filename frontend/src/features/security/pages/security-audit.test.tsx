import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import SecurityAuditPage from './security-audit';

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

// `let` so a test can append a host-namespace container without redefining the fixture.
const mockEntries: Array<Record<string, unknown>> = [
  {
    containerId: 'c1',
    containerName: 'api',
    stackName: 'core',
    endpointId: 1,
    endpointName: 'prod',
    state: 'running',
    status: 'Up',
    image: 'api:latest',
    posture: { capAdd: ['NET_ADMIN'], privileged: false, networkMode: 'bridge', pidMode: 'private' },
    findings: [{ severity: 'warning', category: 'dangerous-capability', title: 'x', description: 'x' }],
    severity: 'warning',
    ignored: false,
  },
  {
    containerId: 'c2',
    containerName: 'redis-cache',
    stackName: 'core',
    endpointId: 1,
    endpointName: 'prod',
    state: 'running',
    status: 'Up',
    image: 'redis:7-alpine',
    posture: { capAdd: [], privileged: false, networkMode: 'bridge', pidMode: 'private' },
    findings: [],
    severity: 'none',
    ignored: false,
  },
];

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [{ id: 1, name: 'prod' }] }),
}));

const auditState = vi.hoisted(() => ({ isLoading: false }));

vi.mock('@/features/security/hooks/use-security-audit', () => ({
  useSecurityAudit: () => ({
    data: auditState.isLoading ? undefined : { entries: mockEntries },
    isLoading: auditState.isLoading,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('SecurityAuditPage', () => {
  it('renders audit table and findings', () => {
    renderWithClient(<SecurityAuditPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Security Audit' })).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('NET_ADMIN')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
  });

  it('leads with the posture answer instead of burying it under the table', () => {
    renderWithClient(<SecurityAuditPage />);

    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '1 of 2 containers have added capabilities, privileged mode, or a host namespace',
    );
    expect(screen.getByTestId('posture-summary')).toBeInTheDocument();
    expect(screen.getByText('Added capabilities')).toBeInTheDocument();
  });

  it('renders only exceptions by default and reveals clean containers on request', () => {
    renderWithClient(<SecurityAuditPage />);

    // redis-cache adds nothing, runs unprivileged and shares no namespace.
    expect(screen.queryByText('redis-cache')).not.toBeInTheDocument();

    const disclosure = screen.getByRole('button', { name: /Show 1 clean container/ });
    fireEvent.click(disclosure);

    expect(screen.getByText('redis-cache')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide 1 clean container/ })).toBeInTheDocument();
  });

  it('renders no severity badge for a container with no findings', () => {
    renderWithClient(<SecurityAuditPage />);
    fireEvent.click(screen.getByRole('button', { name: /Show 1 clean container/ }));

    // A coloured pill reading NONE is a badge for the absence of a finding.
    expect(screen.queryByText('none')).not.toBeInTheDocument();
  });

  it('says nothing about isolation when the container uses Docker defaults', () => {
    renderWithClient(<SecurityAuditPage />);

    expect(screen.getByRole('columnheader', { name: /Isolation/ })).toBeInTheDocument();
    expect(screen.queryByText(/net=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pid=/)).not.toBeInTheDocument();
  });

  it('names a host namespace when one is actually shared', () => {
    mockEntries.push({
      containerId: 'c3',
      containerName: 'node-exporter',
      stackName: 'core',
      endpointId: 1,
      endpointName: 'prod',
      state: 'running',
      status: 'Up',
      image: 'prom/node-exporter',
      posture: { capAdd: [], privileged: false, networkMode: 'host', pidMode: 'host' },
      findings: [],
      severity: 'none',
      ignored: false,
    });
    try {
      renderWithClient(<SecurityAuditPage />);
      expect(screen.getByText('host network, host PID namespace')).toBeInTheDocument();
    } finally {
      mockEntries.pop();
    }
  });

  it('links to the page where the ignore list is actually edited', () => {
    renderWithClient(<SecurityAuditPage />);

    const link = screen.getByRole('link', { name: /Manage ignore list/ });
    expect(link).toHaveAttribute('href', '/settings?tab=security');
  });

  it('renders the shared DataTable with column headers', () => {
    renderWithClient(<SecurityAuditPage />);

    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Capabilities Added/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Privileged/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Severity/ })).toBeInTheDocument();
  });

  it('renders the search input', () => {
    renderWithClient(<SecurityAuditPage />);
    expect(screen.getByPlaceholderText('Search containers by name or image...')).toBeInTheDocument();
  });

  it('filters containers by name when searching', () => {
    renderWithClient(<SecurityAuditPage />);

    expect(screen.getByText('api')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search containers by name or image...'), { target: { value: 'redis' } });

    expect(screen.queryByText('api')).not.toBeInTheDocument();
    expect(screen.getByText('redis-cache')).toBeInTheDocument();
  });

  it('filters containers by image when searching', () => {
    renderWithClient(<SecurityAuditPage />);

    fireEvent.change(screen.getByPlaceholderText('Search containers by name or image...'), { target: { value: 'alpine' } });

    expect(screen.queryByText('api')).not.toBeInTheDocument();
    expect(screen.getByText('redis-cache')).toBeInTheDocument();
  });

  it('shows empty state when search matches nothing', () => {
    renderWithClient(<SecurityAuditPage />);

    fireEvent.change(screen.getByPlaceholderText('Search containers by name or image...'), { target: { value: 'nonexistent' } });

    expect(screen.getByText('No matching containers')).toBeInTheDocument();
  });

  it('renders skeleton rows instead of raw loading text while loading (#1549)', () => {
    auditState.isLoading = true;
    try {
      renderWithClient(<SecurityAuditPage />);

      expect(screen.getByRole('status', { name: 'Loading security audit' })).toBeInTheDocument();
      expect(screen.queryByText('Loading security audit...')).not.toBeInTheDocument();
    } finally {
      auditState.isLoading = false;
    }
  });
});
