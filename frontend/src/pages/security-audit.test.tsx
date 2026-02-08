import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SecurityAuditPage from './security-audit';

const mockEntries = [
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

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [{ id: 1, name: 'prod' }] }),
}));

vi.mock('@/hooks/use-security-audit', () => ({
  useSecurityAudit: () => ({
    data: { entries: mockEntries },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('SecurityAuditPage', () => {
  it('renders audit table and findings', () => {
    render(<SecurityAuditPage />);

    expect(screen.getByText('Security Audit')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('NET_ADMIN')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
  });

  it('renders the search input', () => {
    render(<SecurityAuditPage />);
    expect(screen.getByPlaceholderText('Search containers by name or image...')).toBeInTheDocument();
  });

  it('filters containers by name when searching', () => {
    render(<SecurityAuditPage />);

    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('redis-cache')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search containers by name or image...'), { target: { value: 'redis' } });

    expect(screen.queryByText('api')).not.toBeInTheDocument();
    expect(screen.getByText('redis-cache')).toBeInTheDocument();
  });

  it('filters containers by image when searching', () => {
    render(<SecurityAuditPage />);

    fireEvent.change(screen.getByPlaceholderText('Search containers by name or image...'), { target: { value: 'alpine' } });

    expect(screen.queryByText('api')).not.toBeInTheDocument();
    expect(screen.getByText('redis-cache')).toBeInTheDocument();
  });

  it('shows empty state when search matches nothing', () => {
    render(<SecurityAuditPage />);

    fireEvent.change(screen.getByPlaceholderText('Search containers by name or image...'), { target: { value: 'nonexistent' } });

    expect(screen.getByText('No matching containers')).toBeInTheDocument();
  });
});
