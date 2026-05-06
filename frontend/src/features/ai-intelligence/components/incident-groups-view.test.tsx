import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';
import type { IncidentGroupsResponse } from '../hooks/use-incident-groups';

vi.mock('../hooks/use-incident-groups', () => ({
  useIncidentGroups: vi.fn(),
}));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const mock = (data: IncidentGroupsResponse) => {
  (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({ data, isLoading: false });
};

describe('IncidentGroupsView — rendering', () => {
  it('renders summary strip with single-bucket-per-container counts', () => {
    mock({
      total_active: 3,
      endpoint_facets: [{ endpoint_id: 1, endpoint_name: 'eA', incident_count: 3 }],
      groups: [
        {
          signature: 'a:b:c', label: 'Critical thing', severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '2026-05-06T00:00:00Z', latest_update_at: '2026-05-06T00:00:00Z',
          top_containers: [{ incident_id: 'x', container_name: 'cn-A', endpoint_id: 1, endpoint_name: 'eA', severity: 'critical', created_at: '2026-05-06T00:00:00Z' }],
          all_container_names: ['cn-A'], names_truncated: false,
        },
        {
          signature: 'd:e:f', label: 'Warning thing', severity: 'warning',
          incident_count: 2, container_count: 2, alert_count: 2,
          earliest_at: '2026-05-06T00:00:00Z', latest_update_at: '2026-05-06T00:00:00Z',
          top_containers: [
            { incident_id: 'y1', container_name: 'cn-A', endpoint_id: 1, endpoint_name: 'eA', severity: 'warning', created_at: '2026-05-06T00:00:00Z' },
            { incident_id: 'y2', container_name: 'cn-B', endpoint_id: 1, endpoint_name: 'eA', severity: 'warning', created_at: '2026-05-06T00:00:00Z' },
          ],
          all_container_names: ['cn-A', 'cn-B'], names_truncated: false,
        },
      ],
    });
    render(wrap(<IncidentGroupsView />));
    // cn-A is in both critical and warning → counts in critical only.
    const summary = screen.getByTestId('summary-strip');
    expect(summary).toHaveTextContent(/Critical:.*1.*container/i);
    expect(summary).toHaveTextContent(/Warning:.*1.*container/i);  // cn-B only
  });

  it('expands critical groups by default, collapses warnings', () => {
    mock({
      total_active: 2,
      endpoint_facets: [],
      groups: [
        { signature: 'crit', label: 'Crit', severity: 'critical', incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'x', container_name: 'cn', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '' }],
          all_container_names: ['cn'], names_truncated: false },
        { signature: 'warn', label: 'Warn', severity: 'warning', incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'y', container_name: 'cn2', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '' }],
          all_container_names: ['cn2'], names_truncated: false },
      ],
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('cn')).toBeInTheDocument();      // critical group expanded
    expect(screen.queryByText('cn2')).not.toBeInTheDocument(); // warning collapsed
  });

  it('toggling a group expands its top-10 rows', async () => {
    mock({
      total_active: 1,
      endpoint_facets: [],
      groups: [
        { signature: 'warn', label: 'Warn', severity: 'warning', incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'y', container_name: 'cn2', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '' }],
          all_container_names: ['cn2'], names_truncated: false },
      ],
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.queryByText('cn2')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Warn/i }));
    expect(screen.getByText('cn2')).toBeInTheDocument();
  });
});
