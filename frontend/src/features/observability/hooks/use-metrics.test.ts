import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// Mock socket provider
const mockOn = vi.fn();
const mockOff = vi.fn();

const mockMonitoringSocket = {
  on: mockOn,
  off: mockOff,
  connected: true,
};

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({
    llmSocket: null,
    monitoringSocket: mockMonitoringSocket,
    remediationSocket: null,
    connected: true,
  }),
}));

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ explanations: [] }),
  },
}));

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (state: { potatoMode: boolean }) => boolean) =>
    selector({ potatoMode: false }),
}));

vi.mock('@/shared/hooks/use-page-visibility', () => ({
  usePageVisibility: () => true,
}));

import { api } from '@/shared/lib/api';
import {
  getContainerMetricsRefetchInterval,
  getHeavyRefetchInterval,
  useAnomalyExplanations,
  useAnomalies,
} from './use-metrics';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

describe('useAnomalyExplanations', () => {
  let eventHandlers: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = {};
    mockOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers[event] = handler;
    });
  });

  it('registers cycle:complete listener on monitoringSocket', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useAnomalyExplanations('container-1'), { wrapper: Wrapper });

    expect(mockOn).toHaveBeenCalledWith('cycle:complete', expect.any(Function));
  });

  it('invalidates query cache when cycle:complete fires', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useAnomalyExplanations('container-1'), { wrapper: Wrapper });

    act(() => {
      eventHandlers['cycle:complete']?.({ duration: 5000, endpoints: 2, containers: 10, totalInsights: 3 });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['anomaly-explanations'] });
  });

  it('cleans up listener on unmount', () => {
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useAnomalyExplanations('container-1'), { wrapper: Wrapper });

    unmount();

    expect(mockOff).toHaveBeenCalledWith('cycle:complete', expect.any(Function));
  });
});

describe('useAnomalies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps the { anomalies } envelope into a bare array', async () => {
    const anomalies = [
      {
        id: 'a1',
        containerId: 'c1',
        endpointId: 1,
        metricType: 'cpu',
        severity: 'high',
        value: 95,
        threshold: 80,
        detectedAt: '2026-05-21T12:00:00.000Z',
        description: 'CPU spike',
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce({ anomalies });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAnomalies(), { wrapper: Wrapper });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/api/metrics/anomalies');
    expect(result.current.data).toEqual(anomalies);
  });

  it('returns an empty array when the envelope has no anomalies', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ anomalies: [] });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAnomalies(), { wrapper: Wrapper });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('metrics polling intervals', () => {
  it('polls quickly while metrics are empty in default mode', () => {
    expect(
      getContainerMetricsRefetchInterval({
        points: 0,
        potatoMode: false,
        isPageVisible: true,
      }),
    ).toBe(15_000);
  });

  it('slows metrics polling once data is present in default mode', () => {
    expect(
      getContainerMetricsRefetchInterval({
        points: 5,
        potatoMode: false,
        isPageVisible: true,
      }),
    ).toBe(60_000);
  });

  it('throttles heavy polling to >=5 minutes in potato mode', () => {
    expect(
      getContainerMetricsRefetchInterval({
        points: 5,
        potatoMode: true,
        isPageVisible: true,
      }),
    ).toBe(300_000);
    expect(
      getHeavyRefetchInterval({
        defaultIntervalMs: 60_000,
        potatoMode: true,
        isPageVisible: true,
      }),
    ).toBe(300_000);
  });

  it('pauses heavy polling when tab is hidden', () => {
    expect(
      getContainerMetricsRefetchInterval({
        points: 5,
        potatoMode: false,
        isPageVisible: false,
      }),
    ).toBe(false);
    expect(
      getHeavyRefetchInterval({
        defaultIntervalMs: 60_000,
        potatoMode: false,
        isPageVisible: false,
      }),
    ).toBe(false);
  });
});
