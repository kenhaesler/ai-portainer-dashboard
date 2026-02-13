import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useUtilizationReport, useTrendsReport } from './use-reports';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url === '/api/reports/utilization') {
        return Promise.resolve({
          timeRange: '24h',
          containers: [],
          fleetSummary: { totalContainers: 0, avgCpu: 0, maxCpu: 0, avgMemory: 0, maxMemory: 0 },
          recommendations: [],
        });
      }
      if (url === '/api/reports/trends') {
        return Promise.resolve({
          timeRange: '24h',
          trends: { cpu: [], memory: [], memory_bytes: [] },
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    }),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useUtilizationReport', () => {
  it('fetches utilization report', async () => {
    const { result } = renderHook(() => useUtilizationReport('24h'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.timeRange).toBe('24h');
    expect(result.current.data?.containers).toEqual([]);
  });

  it('passes time range and scope params to utilization endpoint', async () => {
    const getSpy = vi.mocked(api.get);
    getSpy.mockClear();

    const { result } = renderHook(
      () => useUtilizationReport('7d', 12, 'container-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledWith('/api/reports/utilization', {
      params: {
        timeRange: '7d',
        endpointId: 12,
        containerId: 'container-1',
        excludeInfrastructure: true,
      },
    });
  });

  it('passes excludeInfrastructure override to utilization endpoint', async () => {
    const getSpy = vi.mocked(api.get);
    getSpy.mockClear();

    const { result } = renderHook(
      () => useUtilizationReport('7d', 12, 'container-1', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledWith('/api/reports/utilization', {
      params: {
        timeRange: '7d',
        endpointId: 12,
        containerId: 'container-1',
        excludeInfrastructure: false,
      },
    });
  });
});

describe('useTrendsReport', () => {
  it('fetches trends report', async () => {
    const { result } = renderHook(() => useTrendsReport('24h'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.trends.cpu).toEqual([]);
  });

  it('passes time range and scope params to trends endpoint', async () => {
    const getSpy = vi.mocked(api.get);
    getSpy.mockClear();

    const { result } = renderHook(
      () => useTrendsReport('30d', 9, 'container-77'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledWith('/api/reports/trends', {
      params: {
        timeRange: '30d',
        endpointId: 9,
        containerId: 'container-77',
        excludeInfrastructure: true,
      },
    });
  });
});
