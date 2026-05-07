import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const mockGroup = (overrides: Partial<{ signature: string; createdAt: string }> = {}) => ({
  signature: overrides.signature ?? 'anomaly:ml-anomaly:cpu',
  label: 'Anomalous CPU usage (ML)',
  severity: 'critical' as const,
  incident_count: 1, container_count: 1, alert_count: 1,
  earliest_at: '', latest_update_at: '',
  top_containers: [{
    incident_id: 'a1', container_name: 'c1',
    endpoint_id: 1, endpoint_name: 'eA',
    severity: 'critical' as const,
    created_at: overrides.createdAt ?? '2026-05-07T10:00:00Z',
    incident_ids: ['a1'], incident_count: 1,
    latest_at: overrides.createdAt ?? '2026-05-07T10:00:00Z',
    latest_summary: null,
    latest_description: 'CPU 91% on c1',
  }],
  all_container_names: ['c1'], names_truncated: false,
});

describe('IncidentGroupsView — row meta (Phase A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the detection-method label as text on the row', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [mockGroup({ signature: 'anomaly:ml-anomaly:cpu' })] },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('ML')).toBeInTheDocument();
  });

  it('renders the Threshold detection-method label for anomaly:threshold:* signatures', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [mockGroup({ signature: 'anomaly:threshold:memory' })] },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('Threshold')).toBeInTheDocument();
  });

  it('renders a category icon distinguishable by data-testid', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [mockGroup({ signature: 'anomaly:ml-anomaly:cpu' })] },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByTestId('row-category-icon')).toBeInTheDocument();
  });

  it('renders the timestamp via formatDate (May 7, 10:00 for the mock fixture in en-US)', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [mockGroup({ createdAt: '2026-05-07T10:00:00Z' })] },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    // formatDate uses Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    // The exact timezone-dependent output is tested via a regex that matches "May 7" forms.
    expect(screen.getByText(/May\s7/)).toBeInTheDocument();
  });

  it('omits the detection-method badge when the signature has no recognised method (e.g. unknown:*)', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [mockGroup({ signature: 'unknown:weird-thing' })] },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.queryByText(/^(ML|Threshold|Prediction|Health Check|Scan|Pattern|Network)$/)).not.toBeInTheDocument();
  });
});
