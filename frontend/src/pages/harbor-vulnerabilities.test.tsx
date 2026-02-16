import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HarborVulnerabilitiesPage from './harbor-vulnerabilities';

vi.mock('@/hooks/use-harbor-vulnerabilities', () => ({
  useHarborStatus: vi.fn(() => ({
    data: {
      configured: true,
      connected: true,
      lastSync: {
        id: 1,
        sync_type: 'full',
        status: 'completed',
        vulnerabilities_synced: 42,
        in_use_matched: 5,
        error_message: null,
        started_at: '2026-02-16T10:00:00Z',
        completed_at: '2026-02-16T10:01:00Z',
      },
    },
  })),
  useHarborVulnerabilities: vi.fn(() => ({
    data: {
      vulnerabilities: [
        {
          id: 1,
          cve_id: 'CVE-2024-1234',
          severity: 'Critical',
          cvss_v3_score: 9.8,
          package: 'openssl',
          version: '1.1.1',
          fixed_version: '1.1.2',
          status: 'fixed',
          description: 'Critical vulnerability in OpenSSL',
          links: '["https://nvd.nist.gov/vuln/detail/CVE-2024-1234"]',
          project_id: 1,
          repository_name: 'myproject/nginx',
          digest: 'sha256:abc',
          tags: '["latest"]',
          in_use: true,
          matching_containers: '[{"id":"abc123","name":"web-proxy","endpoint":1}]',
          synced_at: '2026-02-16T10:01:00Z',
        },
        {
          id: 2,
          cve_id: 'CVE-2024-5678',
          severity: 'Medium',
          cvss_v3_score: 5.5,
          package: 'libc',
          version: '2.31',
          fixed_version: null,
          status: null,
          description: 'Medium vulnerability',
          links: null,
          project_id: 1,
          repository_name: 'myproject/redis',
          digest: 'sha256:def',
          tags: null,
          in_use: false,
          matching_containers: null,
          synced_at: '2026-02-16T10:01:00Z',
        },
      ],
      summary: {
        total: 42,
        critical: 5,
        high: 10,
        medium: 15,
        low: 12,
        in_use_total: 8,
        in_use_critical: 3,
        fixable: 20,
        excepted: 2,
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  useTriggerHarborSync: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

describe('HarborVulnerabilitiesPage', () => {
  it('renders the page title', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('Vulnerability Management')).toBeInTheDocument();
  });

  it('renders summary cards', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('Total Vulnerabilities')).toBeInTheDocument();
    // 'Critical' appears in both summary card and severity badges
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    expect(screen.getByText('In-Use Critical')).toBeInTheDocument();
    expect(screen.getByText('Fixable')).toBeInTheDocument();
    expect(screen.getByText('Excepted')).toBeInTheDocument();
  });

  it('renders vulnerability table with CVE IDs', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('CVE-2024-1234')).toBeInTheDocument();
    expect(screen.getByText('CVE-2024-5678')).toBeInTheDocument();
  });

  it('shows package names and versions', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('openssl')).toBeInTheDocument();
    expect(screen.getByText('1.1.1')).toBeInTheDocument();
  });

  it('renders severity badges', () => {
    render(<HarborVulnerabilitiesPage />);
    const criticalBadges = screen.getAllByText('Critical');
    expect(criticalBadges.length).toBeGreaterThan(0);
  });

  it('shows in-use indicator for running containers', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('1 container')).toBeInTheDocument();
  });

  it('shows fix version when available', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('Fix: 1.1.2')).toBeInTheDocument();
  });

  it('renders sync button', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('Sync Now')).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByPlaceholderText(/Search by CVE/)).toBeInTheDocument();
  });
});

describe('HarborVulnerabilitiesPage (not configured)', () => {
  it('shows configuration message when Harbor is not set up', async () => {
    const mod = await import('@/hooks/use-harbor-vulnerabilities');
    vi.mocked(mod.useHarborStatus).mockReturnValueOnce({
      data: { configured: false, connected: false, lastSync: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      // Provide minimal required fields for useQuery return type
    } as ReturnType<typeof mod.useHarborStatus>);

    render(<HarborVulnerabilitiesPage />);
    expect(screen.getByText('Harbor Not Configured')).toBeInTheDocument();
  });
});
