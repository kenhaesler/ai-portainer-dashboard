import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const mockMonitoringSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

let monitoringSocketRef: typeof mockMonitoringSocket | null = mockMonitoringSocket;

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({ monitoringSocket: monitoringSocketRef }),
}));

import { api } from '@/shared/lib/api';
import {
  useInvestigations,
  useInvestigationDetail,
  useInvestigationByInsightId,
  safeParseJson,
  type Investigation,
} from './use-investigations';

const mockApi = vi.mocked(api);

function makeInvestigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    id: 'inv-1',
    insight_id: 'insight-1',
    endpoint_id: 1,
    container_id: 'c1',
    container_name: 'web',
    status: 'complete',
    evidence_summary: null,
    root_cause: null,
    contributing_factors: null,
    severity_assessment: null,
    recommended_actions: null,
    confidence_score: null,
    analysis_duration_ms: null,
    llm_model: null,
    ai_summary: null,
    error_message: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function getHandler(eventName: string) {
  const call = mockMonitoringSocket.on.mock.calls.find((c: unknown[]) => c[0] === eventName);
  return call ? (call[1] as (...args: unknown[]) => void) : undefined;
}

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for null/undefined/empty input', () => {
    expect(safeParseJson(null)).toBeNull();
    expect(safeParseJson(undefined)).toBeNull();
    expect(safeParseJson('')).toBeNull();
  });

  it('returns null for malformed JSON instead of throwing', () => {
    expect(safeParseJson('{not json')).toBeNull();
  });
});

describe('useInvestigations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monitoringSocketRef = mockMonitoringSocket;
  });

  it('hydrates investigations from the initial fetch', async () => {
    const initial = [makeInvestigation({ id: 'a' }), makeInvestigation({ id: 'b' })];
    mockApi.get.mockResolvedValueOnce({ investigations: initial });

    const { result } = renderHook(() => useInvestigations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.investigations).toHaveLength(2));
    expect(mockApi.get).toHaveBeenCalledWith('/api/investigations');
  });

  it('subscribes and cleans up monitoring socket events', async () => {
    mockApi.get.mockResolvedValueOnce({ investigations: [] });

    const { unmount } = renderHook(() => useInvestigations(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockMonitoringSocket.on).toHaveBeenCalledWith(
        'investigation:complete',
        expect.any(Function),
      );
      expect(mockMonitoringSocket.on).toHaveBeenCalledWith(
        'investigation:update',
        expect.any(Function),
      );
    });

    unmount();
    expect(mockMonitoringSocket.off).toHaveBeenCalledWith(
      'investigation:complete',
      expect.any(Function),
    );
    expect(mockMonitoringSocket.off).toHaveBeenCalledWith(
      'investigation:update',
      expect.any(Function),
    );
  });

  it('inserts a new investigation when investigation:complete fires for an unknown id', async () => {
    mockApi.get.mockResolvedValueOnce({ investigations: [] });

    const { result } = renderHook(() => useInvestigations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const handler = getHandler('investigation:complete');
    expect(handler).toBeDefined();

    act(() => handler!(makeInvestigation({ id: 'new' })));
    expect(result.current.investigations.map((i) => i.id)).toContain('new');
  });

  it('replaces an existing investigation when investigation:complete fires for a known id', async () => {
    const existing = makeInvestigation({ id: 'inv-1', status: 'pending' });
    mockApi.get.mockResolvedValueOnce({ investigations: [existing] });

    const { result } = renderHook(() => useInvestigations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.investigations).toHaveLength(1));

    const handler = getHandler('investigation:complete');
    act(() => handler!(makeInvestigation({ id: 'inv-1', status: 'complete' })));

    expect(result.current.investigations).toHaveLength(1);
    expect(result.current.investigations[0].status).toBe('complete');
  });

  it('updates only the matching investigation status on investigation:update', async () => {
    const existing = makeInvestigation({ id: 'inv-1', status: 'pending' });
    mockApi.get.mockResolvedValueOnce({ investigations: [existing] });

    const { result } = renderHook(() => useInvestigations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.investigations).toHaveLength(1));

    const handler = getHandler('investigation:update');
    act(() => handler!({ id: 'inv-1', status: 'analyzing' }));

    expect(result.current.investigations[0].status).toBe('analyzing');
  });

  it('getInvestigationForInsight finds by insight_id', async () => {
    const investigation = makeInvestigation({ insight_id: 'insight-42' });
    mockApi.get.mockResolvedValueOnce({ investigations: [investigation] });

    const { result } = renderHook(() => useInvestigations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.investigations).toHaveLength(1));

    expect(result.current.getInvestigationForInsight('insight-42')?.id).toBe(investigation.id);
    expect(result.current.getInvestigationForInsight('missing')).toBeUndefined();
  });

  it('does not subscribe when monitoringSocket is null', async () => {
    monitoringSocketRef = null;
    mockApi.get.mockResolvedValueOnce({ investigations: [] });

    renderHook(() => useInvestigations(), { wrapper: createWrapper() });
    // No subscriptions should be attempted on the null socket — assertion via mock not being called
    expect(mockMonitoringSocket.on).not.toHaveBeenCalled();
  });
});

describe('useInvestigationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monitoringSocketRef = mockMonitoringSocket;
  });

  it('fetches detail when id is provided', async () => {
    const inv = makeInvestigation({ id: 'inv-9' });
    mockApi.get.mockResolvedValueOnce(inv);

    const { result } = renderHook(() => useInvestigationDetail('inv-9'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/investigations/inv-9');
    expect(result.current.data).toEqual(inv);
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => useInvestigationDetail(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});

describe('useInvestigationByInsightId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monitoringSocketRef = mockMonitoringSocket;
  });

  it('fetches investigation by insight id when provided', async () => {
    const inv = makeInvestigation({ insight_id: 'insight-7' });
    mockApi.get.mockResolvedValueOnce(inv);

    const { result } = renderHook(() => useInvestigationByInsightId('insight-7'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/investigations/by-insight/insight-7');
  });

  it('does not fetch when insightId is undefined', () => {
    const { result } = renderHook(() => useInvestigationByInsightId(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});
