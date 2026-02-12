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

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ explanations: [] }),
  },
}));

import { useAnomalyExplanations } from './use-metrics';

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
