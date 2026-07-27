import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';
import type { IncidentGroupsResponse } from '../hooks/use-incident-groups';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (c: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{c}</MemoryRouter>
  </QueryClientProvider>
);

const dummyGroup = {
  signature: 'dummy',
  label: 'Dummy',
  severity: 'info' as const,
  incident_count: 0,
  container_count: 0,
  alert_count: 0,
  earliest_at: '',
  latest_update_at: '',
  top_containers: [],
  all_container_names: [],
  names_truncated: false,
};

describe('IncidentGroupsView — endpoint chip overflow', () => {
  it('does not render the chip row when 1 or 0 endpoints', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 0,
        groups: [dummyGroup],
        endpoint_facets: [{ endpoint_id: 1, endpoint_name: 'e0', incident_count: 1 }],
      } as IncidentGroupsResponse,
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.queryByTestId('endpoint-chip-row')).not.toBeInTheDocument();
  });

  it('renders <=8 endpoints inline, no dropdown', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 5,
        groups: [dummyGroup],
        endpoint_facets: Array.from({ length: 5 }, (_, i) => ({
          endpoint_id: i,
          endpoint_name: `e${i}`,
          incident_count: 1,
        })),
      } as IncidentGroupsResponse,
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByTestId('endpoint-chip-row')).toBeInTheDocument();
    expect(screen.queryByText(/more/i)).not.toBeInTheDocument();
  });

  it('renders +N more dropdown when >8 endpoints', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 12,
        groups: [dummyGroup],
        endpoint_facets: Array.from({ length: 12 }, (_, i) => ({
          endpoint_id: i,
          endpoint_name: `e${i}`,
          incident_count: 1,
        })),
      } as IncidentGroupsResponse,
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText(/\+4 more/i)).toBeInTheDocument();
  });

  it('renders the endpoint facets as counts, not as dead filter buttons', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 33,
        groups: [dummyGroup],
        endpoint_facets: [
          { endpoint_id: 3, endpoint_name: 'docker-dev-1', incident_count: 23 },
          { endpoint_id: 1, endpoint_name: 'local', incident_count: 10 },
        ],
      } as IncidentGroupsResponse,
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));

    const row = screen.getByTestId('endpoint-chip-row');
    expect(row).toHaveTextContent('docker-dev-1');
    expect(row).toHaveTextContent('23');
    // They used to be <button type="button"> with no onClick and no state,
    // in the same pill language as the working severity filter chips above.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });
});
