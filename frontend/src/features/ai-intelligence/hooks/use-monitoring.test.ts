import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ insights: [], total: 0 }),
    post: vi.fn(),
  },
}));

const mockMonitoringSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({
    monitoringSocket: mockMonitoringSocket,
  }),
}));

import { useMonitoring, type Insight } from './use-monitoring';

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: `insight-${Math.random().toString(36).slice(2)}`,
    endpoint_id: 1,
    endpoint_name: 'test-env',
    container_id: 'c1',
    container_name: 'test-container',
    severity: 'warning',
    category: 'resource',
    title: 'Test insight',
    description: 'A test insight',
    suggested_action: null,
    is_acknowledged: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useMonitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getHandler(eventName: string) {
    const call = mockMonitoringSocket.on.mock.calls.find(
      (c: string[]) => c[0] === eventName,
    );
    return call ? call[1] : undefined;
  }

  it('listens for insights:new events', () => {
    renderHook(() => useMonitoring(), { wrapper: createWrapper() });

    expect(mockMonitoringSocket.on).toHaveBeenCalledWith('insights:new', expect.any(Function));
  });

  it('listens for insights:batch events', () => {
    renderHook(() => useMonitoring(), { wrapper: createWrapper() });

    expect(mockMonitoringSocket.on).toHaveBeenCalledWith('insights:batch', expect.any(Function));
  });

  it('handles single insight events with debounce', async () => {
    const { result } = renderHook(() => useMonitoring(), {
      wrapper: createWrapper(),
    });

    const handler = getHandler('insights:new');
    const insight = makeInsight({ id: 'new-1' });

    act(() => {
      handler(insight);
    });

    // Not yet flushed (debounce)
    expect(result.current.insights).toHaveLength(0);

    // Advance past debounce timer
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.insights).toHaveLength(1);
    expect(result.current.insights[0].id).toBe('new-1');
  });

  it('handles batch insight events', async () => {
    const { result } = renderHook(() => useMonitoring(), {
      wrapper: createWrapper(),
    });

    const handler = getHandler('insights:batch');
    const batch = [
      makeInsight({ id: 'b1' }),
      makeInsight({ id: 'b2' }),
      makeInsight({ id: 'b3' }),
    ];

    act(() => {
      handler(batch);
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.insights).toHaveLength(3);
  });

  it('caps insights at 1000 entries', async () => {
    const { result } = renderHook(() => useMonitoring(), {
      wrapper: createWrapper(),
    });

    const handler = getHandler('insights:batch');

    // Send a batch of 1100 insights
    const largeBatch = Array.from({ length: 1100 }, (_, i) =>
      makeInsight({ id: `lg-${i}` }),
    );

    act(() => {
      handler(largeBatch);
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.insights).toHaveLength(1000);
  });

  it('filters batch events by subscribed severities', async () => {
    const { result } = renderHook(() => useMonitoring(), {
      wrapper: createWrapper(),
    });

    // Unsubscribe from 'info'
    act(() => {
      result.current.unsubscribeSeverity('info');
    });

    // After unsubscribe, the effect re-runs and re-registers handlers.
    // Get the LATEST handler (last call to on('insights:batch', ...))
    const batchCalls = mockMonitoringSocket.on.mock.calls.filter(
      (c: string[]) => c[0] === 'insights:batch',
    );
    const latestHandler = batchCalls[batchCalls.length - 1][1];

    const batch = [
      makeInsight({ id: 'critical-1', severity: 'critical' }),
      makeInsight({ id: 'info-1', severity: 'info' }),
      makeInsight({ id: 'warning-1', severity: 'warning' }),
    ];

    act(() => {
      latestHandler(batch);
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // info should be filtered out
    const ids = result.current.insights.map((i) => i.id);
    expect(ids).toContain('critical-1');
    expect(ids).toContain('warning-1');
    expect(ids).not.toContain('info-1');
  });

  it('debounces rapid events (300ms)', async () => {
    const { result } = renderHook(() => useMonitoring(), {
      wrapper: createWrapper(),
    });

    const handler = getHandler('insights:new');

    act(() => {
      handler(makeInsight({ id: 'r1' }));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      handler(makeInsight({ id: 'r2' }));
    });

    // Still within debounce window — nothing flushed yet
    expect(result.current.insights).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Both should appear after debounce
    expect(result.current.insights).toHaveLength(2);
  });
});
