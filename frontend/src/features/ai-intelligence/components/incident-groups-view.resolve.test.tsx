import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// ConfirmDialog: simplest mock that immediately calls onConfirm.
// The real dialog opens a modal. For tests we render it inline so the
// "Confirm" button is always in the DOM when pendingGroup is set.
vi.mock('@/shared/components/feedback/confirm-dialog', () => ({
  ConfirmDialog: (props: {
    open: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmLabel?: string;
    title?: string;
    description?: string;
  }) =>
    props.open ? (
      <div role="dialog">
        <button onClick={props.onConfirm}>{props.confirmLabel ?? 'Confirm'}</button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    ) : null,
}));

import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (c: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <MemoryRouter>{c}</MemoryRouter>
  </QueryClientProvider>
);

const groupOf = (ids: string[]) => ({
  signature: 'g', label: 'Grp', severity: 'critical' as const,
  incident_count: ids.length, container_count: ids.length, alert_count: ids.length,
  earliest_at: '', latest_update_at: '',
  top_containers: ids.map((id, i) => ({
    incident_id: id, container_name: `cn-${i}`, endpoint_id: 1, endpoint_name: 'e',
    severity: 'critical' as const, created_at: '',
    incident_ids: [id], incident_count: 1, latest_at: '', latest_summary: null, latest_description: null,
  })),
  all_container_names: ids.map((_, i) => `cn-${i}`),
  names_truncated: false,
});

beforeEach(() => vi.clearAllMocks());

describe('IncidentGroupsView — resolve', () => {
  it('per-group "Resolve all N" calls batch endpoint with the group ids', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 3, endpoint_facets: [], groups: [groupOf(['x', 'y', 'z'])] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ resolved: ['x', 'y', 'z'], failed: [] });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 3/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(api.post).toHaveBeenCalledWith('/api/incidents/resolve', { ids: ['x', 'y', 'z'] });
  });

  it('resolves all dedupe siblings when a row has incident_ids with multiple entries', async () => {
    const group = groupOf(['a1']);
    // Override the single row to represent two incidents (dedupe pair)
    group.top_containers[0].incident_ids = ['a1', 'a1b'];
    group.top_containers[0].incident_count = 2;
    group.incident_count = 2;

    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 2, endpoint_facets: [], groups: [group] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ resolved: ['a1', 'a1b'], failed: [] });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 2/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(api.post).toHaveBeenCalledWith('/api/incidents/resolve', { ids: ['a1', 'a1b'] });
  });

  it('partial failure ≤5 keeps failed inline with retry option', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 3, endpoint_facets: [], groups: [groupOf(['x', 'y', 'z'])] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      resolved: ['x', 'z'],
      failed: [{ id: 'y', error: 'boom' }],
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 3/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/Retry 1 failed/i)).toBeInTheDocument();
  });

  it('partial failure >5 collapses into a banner with Retry failed only', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `i${i}`);
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 12, endpoint_facets: [], groups: [groupOf(ids)] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      resolved: ids.slice(0, 5),
      failed: ids.slice(5).map((id) => ({ id, error: 'e' })),
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 12/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/7 of 12 resolves failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry failed only/i })).toBeInTheDocument();
  });
});
