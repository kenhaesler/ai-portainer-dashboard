import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

const baseGroup = (incidentIds: string[]) => ({
  signature: 's',
  label: 'Anomalous CPU usage (ML)',
  severity: 'critical' as const,
  incident_count: incidentIds.length,
  container_count: 1,
  alert_count: incidentIds.length,
  earliest_at: '', latest_update_at: '',
  top_containers: [{
    incident_id: incidentIds[0], container_name: 'c1',
    endpoint_id: 1, endpoint_name: 'eA',
    severity: 'critical' as const,
    created_at: '2026-05-07T10:00:00Z',
    incident_ids: incidentIds, incident_count: incidentIds.length,
    latest_at: '2026-05-07T10:00:00Z',
    latest_summary: null,
    latest_description: 'CPU 91% on c1',
  }],
  all_container_names: ['c1'], names_truncated: false,
});

const incidentDetail = (id: string, insightIds: string[]) => ({
  id,
  relatedInsights: insightIds.map((iid) => ({
    id: iid, endpoint_id: 1, endpoint_name: 'eA',
    container_id: 'cid-c1', container_name: 'c1',
    severity: 'critical', category: 'anomaly',
    title: `Anomalous cpu usage on c1 (event ${iid})`,
    description: `desc-${iid}`,
    suggested_action: null,
    is_acknowledged: 0,
    created_at: '2026-05-07T10:00:00Z',
    metric_type: 'cpu', detection_method: 'ml-anomaly',
  })),
});

describe('IncidentGroupsView — click-to-expand drawer (Phase B)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not fetch incident details until a row is clicked', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [baseGroup(['a1'])] },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    // The /api/incidents/:id endpoint must NOT be called on initial render.
    const incidentDetailCalls = (api.get as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => typeof url === 'string' && url.match(/\/api\/incidents\/[^/]+$/));
    expect(incidentDetailCalls).toHaveLength(0);
  });

  it('fetches incident details and renders an InsightCard per related insight when the row is expanded', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [baseGroup(['a1'])] },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/incidents/a1') return Promise.resolve(incidentDetail('a1', ['ins-1', 'ins-2']));
      return Promise.resolve({ incidents: [], counts: { active: 0, resolved: 0, total: 0 }, limit: 50, offset: 0 });
    });

    render(wrap(<IncidentGroupsView />));
    const expander = screen.getByRole('button', { name: /expand events for c1/i });
    await userEvent.click(expander);

    await waitFor(() => {
      expect(screen.getByText(/Anomalous cpu usage on c1 \(event ins-1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Anomalous cpu usage on c1 \(event ins-2\)/)).toBeInTheDocument();
    });
  });

  it('fetches all incident_ids in parallel when incident_count > 1', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 2, endpoint_facets: [], groups: [baseGroup(['a1', 'a1b'])] },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/incidents/a1') return Promise.resolve(incidentDetail('a1', ['ins-1']));
      if (url === '/api/incidents/a1b') return Promise.resolve(incidentDetail('a1b', ['ins-2']));
      return Promise.resolve({ incidents: [], counts: { active: 0, resolved: 0, total: 0 }, limit: 50, offset: 0 });
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /expand events for c1/i }));

    await waitFor(() => {
      expect(screen.getByText(/event ins-1/)).toBeInTheDocument();
      expect(screen.getByText(/event ins-2/)).toBeInTheDocument();
    });
    const calls = (api.get as ReturnType<typeof vi.fn>).mock.calls.map(([u]) => u);
    expect(calls).toContain('/api/incidents/a1');
    expect(calls).toContain('/api/incidents/a1b');
  });

  it('shows a loading indicator while the fetch is in flight', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [baseGroup(['a1'])] },
      isLoading: false,
    });
    let resolveDetail: (value: unknown) => void = () => {};
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/incidents/a1') return new Promise((res) => { resolveDetail = res; });
      return Promise.resolve({});
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /expand events for c1/i }));
    expect(screen.getByText(/loading events/i)).toBeInTheDocument();

    resolveDetail(incidentDetail('a1', ['ins-1']));
    await waitFor(() => expect(screen.queryByText(/loading events/i)).not.toBeInTheDocument());
  });

  it('shows an error message when all detail fetches fail', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [baseGroup(['a1'])] },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/incidents/a1') return Promise.reject(new Error('Network error'));
      return Promise.resolve({});
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /expand events for c1/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to load events/i)).toBeInTheDocument();
    });
  });
});
