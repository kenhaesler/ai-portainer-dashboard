import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { api } from '@/shared/lib/api';
import { useIncidentInsights } from './use-incident-insights';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const incidentDetail = (id: string, insightIds: string[]) => ({
  id,
  title: `incident ${id}`,
  severity: 'critical',
  status: 'active',
  related_insight_ids: insightIds,
  affected_containers: ['c1'],
  endpoint_id: 1, endpoint_name: 'eA',
  correlation_type: 'temporal', correlation_confidence: 'high',
  insight_count: insightIds.length,
  summary: null, signature: 'anomaly:ml-anomaly:cpu',
  created_at: '2026-05-07T10:00:00Z', updated_at: '2026-05-07T10:00:00Z', resolved_at: null,
  relatedInsights: insightIds.map((iid) => ({
    id: iid,
    endpoint_id: 1, endpoint_name: 'eA',
    container_id: 'cid-c1', container_name: 'c1',
    severity: 'critical',
    category: 'anomaly',
    title: `insight ${iid}`,
    description: `desc ${iid}`,
    suggested_action: null,
    is_acknowledged: 0,
    created_at: '2026-05-07T10:00:00Z',
    metric_type: 'cpu',
    detection_method: 'ml-anomaly',
  })),
});

describe('useIncidentInsights', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty insights when ids is empty', async () => {
    const { result } = renderHook(() => useIncidentInsights([]), { wrapper: createWrapper() });
    expect(result.current.insights).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('flattens relatedInsights from multiple incident fetches', async () => {
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(incidentDetail('a1', ['ins-1', 'ins-2']))
      .mockResolvedValueOnce(incidentDetail('a1b', ['ins-3']));

    const { result } = renderHook(() => useIncidentInsights(['a1', 'a1b']), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ids = result.current.insights.map((i) => i.id);
    expect(ids.sort()).toEqual(['ins-1', 'ins-2', 'ins-3']);
  });

  it('dedupes insights that appear in multiple incidents', async () => {
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(incidentDetail('a1', ['ins-shared']))
      .mockResolvedValueOnce(incidentDetail('a1b', ['ins-shared']));

    const { result } = renderHook(() => useIncidentInsights(['a1', 'a1b']), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.insights.map((i) => i.id)).toEqual(['ins-shared']);
  });

  it('reports isError=true only when all queries fail', async () => {
    (api.get as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom-1'))
      .mockRejectedValueOnce(new Error('boom-2'));

    const { result } = renderHook(() => useIncidentInsights(['a1', 'a1b']), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/boom/);
  });

  it('returns partial results when some queries fail', async () => {
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(incidentDetail('a1', ['ins-1']))
      .mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useIncidentInsights(['a1', 'a1b']), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.insights.map((i) => i.id)).toEqual(['ins-1']);
    // One query failed but at least one succeeded → isError stays false.
    expect(result.current.isError).toBe(false);
  });
});
