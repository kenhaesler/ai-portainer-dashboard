import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useComparisonMetrics, ComparisonTarget } from './use-container-comparison';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/lib/api';
const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useComparisonMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const targets: ComparisonTarget[] = [
    { containerId: 'abc123', endpointId: 1, name: 'web-1' },
    { containerId: 'def456', endpointId: 1, name: 'web-2' },
  ];

  it('should fetch metrics for each target', async () => {
    mockApi.get.mockResolvedValue({
      containerId: 'abc123',
      endpointId: 1,
      metricType: 'cpu',
      timeRange: '1h',
      data: [{ timestamp: '2025-01-01T00:00:00Z', value: 42 }],
    });

    const { result } = renderHook(
      () => useComparisonMetrics(targets, 'cpu', '1h'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockApi.get).toHaveBeenCalledTimes(2);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0].target.name).toBe('web-1');
    expect(result.current.data[1].target.name).toBe('web-2');
  });

  it('should not fetch when fewer than 2 targets', async () => {
    const singleTarget = [targets[0]];

    renderHook(
      () => useComparisonMetrics(singleTarget, 'cpu', '1h'),
      { wrapper: createWrapper() },
    );

    // Wait a tick — query should NOT fire
    await new Promise((r) => setTimeout(r, 50));
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('should report isError when a request fails', async () => {
    mockApi.get
      .mockResolvedValueOnce({
        containerId: 'abc123',
        endpointId: 1,
        metricType: 'cpu',
        timeRange: '1h',
        data: [],
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(
      () => useComparisonMetrics(targets, 'cpu', '1h'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
  });
});
