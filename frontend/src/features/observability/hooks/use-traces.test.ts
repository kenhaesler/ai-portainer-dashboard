import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import {
  useTraces,
  useTrace,
  useServiceMap,
  useTraceSummary,
  type TracesOptions,
} from './use-traces';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useTraces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches traces with no params when none supplied', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useTraces(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces', { params: undefined });
  });

  it('passes filter options through to the api layer', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const options: TracesOptions = {
      serviceName: 'web',
      status: 'error',
      limit: 50,
      minDuration: 100,
    };

    const { result } = renderHook(() => useTraces(options), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces', { params: options });
  });

  it('returns the array data on success', async () => {
    const traces = [
      {
        traceId: 't1',
        spans: [],
        rootSpan: {
          traceId: 't1',
          spanId: 's1',
          operationName: 'GET /',
          serviceName: 'web',
          startTime: '0',
          duration: 10,
          status: 'ok',
        },
        duration: 10,
        services: ['web'],
        startTime: '0',
        status: 'ok',
      },
    ];
    mockApi.get.mockResolvedValueOnce(traces);

    const { result } = renderHook(() => useTraces(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(traces);
  });

  it('surfaces fetch errors', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useTraces(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a single trace when traceId is provided', async () => {
    mockApi.get.mockResolvedValueOnce({
      traceId: 't1',
      spans: [],
      rootSpan: {
        traceId: 't1',
        spanId: 's1',
        operationName: 'op',
        serviceName: 'svc',
        startTime: '0',
        duration: 1,
        status: 'ok',
      },
      duration: 1,
      services: [],
      startTime: '0',
      status: 'ok',
    });

    const { result } = renderHook(() => useTrace('t1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces/t1');
  });

  it('does not fetch when traceId is undefined', () => {
    const { result } = renderHook(() => useTrace(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});

describe('useServiceMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches service map with options as params', async () => {
    mockApi.get.mockResolvedValueOnce({ nodes: [], edges: [] });

    const options: TracesOptions = { serviceName: 'web' };
    const { result } = renderHook(() => useServiceMap(options), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces/service-map', { params: options });
  });
});

describe('useTraceSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches trace summary', async () => {
    mockApi.get.mockResolvedValueOnce({
      totalTraces: 10,
      avgDuration: 100,
      errorRate: 0.1,
      services: 2,
    });

    const { result } = renderHook(() => useTraceSummary(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces/summary', { params: undefined });
    expect(result.current.data?.totalTraces).toBe(10);
  });

  it('passes filter options through to the api layer', async () => {
    mockApi.get.mockResolvedValueOnce({
      totalTraces: 0,
      avgDuration: 0,
      errorRate: 0,
      services: 0,
    });

    const options = { serviceName: 'web' };
    const { result } = renderHook(() => useTraceSummary(options), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces/summary', { params: options });
  });
});
