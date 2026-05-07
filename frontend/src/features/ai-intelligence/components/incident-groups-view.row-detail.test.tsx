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

describe('IncidentGroupsView — per-row detail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the latest_description on each row', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 'anomaly:ml-anomaly:cpu',
          label: 'Anomalous CPU usage (ML)',
          severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1'], incident_count: 1,
            latest_at: '', latest_summary: 'CPU spike on c1 — investigate',
            latest_description: 'CPU 94% on c1 — baseline 22%, ML high confidence',
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('CPU 94% on c1 — baseline 22%, ML high confidence')).toBeInTheDocument();
  });

  it('falls back to latest_summary when latest_description is null', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 's', label: 'Sig', severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1'], incident_count: 1,
            latest_at: '', latest_summary: 'fallback summary',
            latest_description: null,
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('fallback summary')).toBeInTheDocument();
  });

  it('renders an "N alerts" badge when incident_count > 1', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 3, endpoint_facets: [],
        groups: [{
          signature: 's', label: 'Sig', severity: 'critical',
          incident_count: 3, container_count: 1, alert_count: 3,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1', 'a2', 'a3'], incident_count: 3,
            latest_at: '', latest_summary: null,
            latest_description: 'CPU 91% on c1',
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('3 alerts')).toBeInTheDocument();
  });

  it('omits the badge when incident_count === 1', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 's', label: 'Sig', severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1'], incident_count: 1,
            latest_at: '', latest_summary: null,
            latest_description: 'CPU 91% on c1',
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    // Match "N alerts" (plural) exactly — distinguishes from group header "1 alert" (singular)
    expect(screen.queryByText(/^\d+ alerts$/)).not.toBeInTheDocument();
  });
});
