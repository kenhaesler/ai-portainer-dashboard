import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
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

const baseGroup = {
  signature: 'big', label: 'Many', severity: 'warning' as const,
  incident_count: 100, container_count: 100, alert_count: 100,
  earliest_at: '', latest_update_at: '', top_containers: [],
  all_container_names: [], names_truncated: true,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('IncidentGroupsView — search debounce', () => {
  it('does not auto-fetch until 250ms quiet', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 100, endpoint_facets: [], groups: [baseGroup] },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      incidents: [], counts: { active: 0, resolved: 0, total: 0 }, limit: 50, offset: 0,
    });
    const { rerender } = render(wrap(<IncidentGroupsView search="a" />));

    // Rapid rerenders before debounce fires
    act(() => { rerender(wrap(<IncidentGroupsView search="ab" />)); });
    act(() => { rerender(wrap(<IncidentGroupsView search="abc" />)); });

    // Before 250ms elapses: no calls
    expect(api.get).not.toHaveBeenCalled();

    // Advance timers past the 250ms debounce window
    await act(async () => { vi.advanceTimersByTime(300); });

    // Exactly one call with the final term
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/incidents', expect.objectContaining({
      params: expect.objectContaining({ q: 'abc' }),
    }));
  });
});
