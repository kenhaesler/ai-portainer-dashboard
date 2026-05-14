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
import { useRed, type UseRedOptions } from './use-red';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const FROM = new Date('2026-05-14T11:00:00.000Z');
const TO = new Date('2026-05-14T12:00:00.000Z');

const SAMPLE_RESULT = {
  buckets: [
    {
      bucketStart: '2026-05-14T11:00:00.000Z',
      rows: [
        {
          group: 'api',
          rate: 1.5,
          errorRate: 0.02,
          p50Ms: 12,
          p95Ms: 80,
          p99Ms: 150,
          callCount: 5400,
        },
      ],
    },
  ],
  truncated: false,
};

describe('useRed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/traces/red with ISO-serialized from/to and pass-through params', async () => {
    mockApi.get.mockResolvedValueOnce(SAMPLE_RESULT);

    const opts: UseRedOptions = {
      from: FROM,
      to: TO,
      bucket: '5m',
      groupBy: 'service',
      service: 'api',
    };
    const { result } = renderHook(() => useRed(opts), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApi.get).toHaveBeenCalledWith('/api/traces/red', {
      params: {
        from: FROM.toISOString(),
        to: TO.toISOString(),
        bucket: '5m',
        groupBy: 'service',
        service: 'api',
      },
    });
  });

  it('omits optional filters that are undefined', async () => {
    mockApi.get.mockResolvedValueOnce(SAMPLE_RESULT);

    const opts: UseRedOptions = {
      from: FROM,
      to: TO,
      bucket: '1m',
      groupBy: 'container',
    };
    const { result } = renderHook(() => useRed(opts), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const [, options] = mockApi.get.mock.calls[0];
    expect(options).toEqual({
      params: {
        from: FROM.toISOString(),
        to: TO.toISOString(),
        bucket: '1m',
        groupBy: 'container',
      },
    });
  });

  it('returns RedResult data on success', async () => {
    mockApi.get.mockResolvedValueOnce(SAMPLE_RESULT);

    const { result } = renderHook(
      () => useRed({ from: FROM, to: TO, bucket: '5m', groupBy: 'service' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.buckets[0].rows[0].callCount).toBe(5400);
    expect(result.current.data?.truncated).toBe(false);
  });

  it('surfaces fetch errors via error', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(
      () => useRed({ from: FROM, to: TO, bucket: '5m', groupBy: 'service' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
  });
});
