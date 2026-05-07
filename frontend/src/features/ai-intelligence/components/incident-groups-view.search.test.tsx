import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (c: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{c}</MemoryRouter>
  </QueryClientProvider>
);

describe('IncidentGroupsView — search', () => {
  it('hides groups whose label and all_container_names do not match', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 2, endpoint_facets: [],
        groups: [
          { signature: 'a', label: 'Apple', severity: 'critical',
            incident_count: 1, container_count: 1, alert_count: 1,
            earliest_at: '', latest_update_at: '',
            top_containers: [{ incident_id: 'x', container_name: 'apple-1', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '', incident_ids: ['x'], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null }],
            all_container_names: ['apple-1'], names_truncated: false },
          { signature: 'b', label: 'Banana', severity: 'critical',
            incident_count: 1, container_count: 1, alert_count: 1,
            earliest_at: '', latest_update_at: '',
            top_containers: [{ incident_id: 'y', container_name: 'banana-1', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '', incident_ids: ['y'], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null }],
            all_container_names: ['banana-1'], names_truncated: false },
        ],
      },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView search="banana" />));
    // Wait for debounce (250ms)
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  it('auto-expands a collapsed group when its container matches', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 'a', label: 'Warn', severity: 'warning',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'x', container_name: 'matchme', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '', incident_ids: ['x'], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null }],
          all_container_names: ['matchme'], names_truncated: false,
        }],
      },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView search="matchme" />));
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByText('matchme')).toBeInTheDocument();
  });

  it('truncated groups delegate search to backend when query is non-empty', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 600, endpoint_facets: [],
        groups: [{
          signature: 'big', label: 'Many', severity: 'warning',
          incident_count: 600, container_count: 600, alert_count: 600,
          earliest_at: '', latest_update_at: '',
          top_containers: [],
          all_container_names: Array.from({ length: 500 }, (_, i) => `cn-${i}`),
          names_truncated: true,
        }],
      },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      incidents: [],
      counts: { active: 0, resolved: 0, total: 0 }, limit: 50, offset: 0,
    });
    render(wrap(<IncidentGroupsView search="cn-700" />));
    await new Promise((r) => setTimeout(r, 300));
    expect(api.get).toHaveBeenCalledWith('/api/incidents', expect.objectContaining({
      params: expect.objectContaining({ signature: 'big', q: 'cn-700' }),
    }));
  });
});
