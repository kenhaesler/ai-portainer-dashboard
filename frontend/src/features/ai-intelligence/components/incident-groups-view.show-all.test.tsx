import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe('IncidentGroupsView — Show all pagination', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders Show all button when container_count > 10 and fetches the long tail on click', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 12, endpoint_facets: [],
        groups: [{
          signature: 'a:b:c', label: 'Big', severity: 'critical',
          incident_count: 12, container_count: 12, alert_count: 12,
          earliest_at: '', latest_update_at: '',
          top_containers: Array.from({ length: 10 }, (_, i) => ({
            incident_id: `i${i}`, container_name: `cn-${i}`,
            endpoint_id: 1, endpoint_name: 'e', severity: 'warning' as const,
            created_at: '',
            incident_ids: [`i${i}`], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null,
          })),
          all_container_names: Array.from({ length: 12 }, (_, i) => `cn-${i}`),
          names_truncated: false,
        }],
      },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      incidents: [
        { id: 'i10', title: 't', signature: 'a:b:c', severity: 'warning', status: 'active',
          affected_containers: ['cn-10'], endpoint_id: 1, endpoint_name: 'e',
          created_at: '', updated_at: '' },
        { id: 'i11', title: 't', signature: 'a:b:c', severity: 'warning', status: 'active',
          affected_containers: ['cn-11'], endpoint_id: 1, endpoint_name: 'e',
          created_at: '', updated_at: '' },
        { id: 'i10b', title: 't', signature: 'a:b:c', severity: 'critical', status: 'active',
          affected_containers: ['cn-10'], endpoint_id: 1, endpoint_name: 'e',
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
          summary: null },
      ],
      counts: { active: 12, resolved: 0, total: 12 },
      limit: 50, offset: 0,
    });

    render(wrap(<IncidentGroupsView />));
    const showAll = screen.getByRole('button', { name: /Show all 12/i });
    await userEvent.click(showAll);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/incidents', expect.objectContaining({
        params: { status: 'active', signature: 'a:b:c', limit: '500' },
      }));
    });
    expect(screen.getByText('cn-10')).toBeInTheDocument();
    expect(screen.getByText('cn-11')).toBeInTheDocument();
    // cn-10 appears in two incidents (i10, i10b). Long-tail must dedupe to a single row.
    expect(screen.getAllByText('cn-10')).toHaveLength(1);
    // Badge shows 2 alerts for that container.
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
  });
});
