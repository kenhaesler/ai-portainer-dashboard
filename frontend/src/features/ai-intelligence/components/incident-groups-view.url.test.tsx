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

const wrap = (initialEntries: string[], children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  </QueryClientProvider>
);

const mock = (data: IncidentGroupsResponse) => {
  (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({ data, isLoading: false });
};

describe('IncidentGroupsView — URL ?expand=', () => {
  it('initial render with ?expand=-<sig> collapses a critical group', () => {
    mock({
      total_active: 1,
      endpoint_facets: [],
      groups: [{
        signature: 'anomaly:ml-anomaly:cpu', label: 'CPU anomaly', severity: 'critical',
        incident_count: 1, container_count: 1, alert_count: 1,
        earliest_at: '', latest_update_at: '',
        top_containers: [{ incident_id: 'x', container_name: 'cn', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '', incident_ids: ['x'], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null }],
        all_container_names: ['cn'], names_truncated: false,
      }],
    });
    render(wrap(
      ['/?expand=-anomaly%3Aml-anomaly%3Acpu'],
      <IncidentGroupsView />,
    ));
    expect(screen.queryByText('cn')).not.toBeInTheDocument();
  });

  it('initial render with ?expand=<sig> opens a warning group', () => {
    mock({
      total_active: 1,
      endpoint_facets: [],
      groups: [{
        signature: 'predictive:prediction:memory', label: 'Mem pred', severity: 'warning',
        incident_count: 1, container_count: 1, alert_count: 1,
        earliest_at: '', latest_update_at: '',
        top_containers: [{ incident_id: 'y', container_name: 'cn-warn', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '', incident_ids: ['y'], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null }],
        all_container_names: ['cn-warn'], names_truncated: false,
      }],
    });
    render(wrap(
      ['/?expand=predictive%3Aprediction%3Amemory'],
      <IncidentGroupsView />,
    ));
    expect(screen.getByText('cn-warn')).toBeInTheDocument();
  });

  it('toggling a critical group closed updates the URL with -<sig>', async () => {
    mock({
      total_active: 1,
      endpoint_facets: [],
      groups: [{
        signature: 'anomaly:ml-anomaly:cpu', label: 'CPU anomaly', severity: 'critical',
        incident_count: 1, container_count: 1, alert_count: 1,
        earliest_at: '', latest_update_at: '',
        top_containers: [{ incident_id: 'x', container_name: 'cn', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '', incident_ids: ['x'], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null }],
        all_container_names: ['cn'], names_truncated: false,
      }],
    });
    render(wrap(['/'], <IncidentGroupsView />));
    expect(screen.getByText('cn')).toBeInTheDocument(); // expanded by default
    await userEvent.click(screen.getByRole('button', { name: /CPU anomaly/i }));
    // Expected: clicking toggles closed.
    expect(screen.queryByText('cn')).not.toBeInTheDocument();
  });
});
