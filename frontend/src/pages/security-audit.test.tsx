import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SecurityAuditPage from './security-audit';

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [{ id: 1, name: 'prod' }] }),
}));

vi.mock('@/hooks/use-security-audit', () => ({
  useSecurityAudit: () => ({
    data: {
      entries: [
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
      ],
    },
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
});
