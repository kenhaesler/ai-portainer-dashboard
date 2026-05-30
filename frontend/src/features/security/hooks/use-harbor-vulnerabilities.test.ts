import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import {
  useHarborStatus,
  useHarborEnabled,
  useHarborVulnerabilities,
  useHarborVulnerabilitySummary,
  useHarborExceptions,
  useTriggerHarborSync,
  useCreateException,
  useDeactivateException,
} from './use-harbor-vulnerabilities';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

describe('useHarborStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches Harbor status', async () => {
    const status = { configured: true, connected: true, lastSync: null };
    mockApi.get.mockResolvedValueOnce(status);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborStatus(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/harbor/status');
    expect(result.current.data).toEqual(status);
  });
});

describe('useHarborEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the lightweight enabled flag', async () => {
    mockApi.get.mockResolvedValueOnce({ enabled: false });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborEnabled(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/harbor/enabled');
    expect(result.current.data).toEqual({ enabled: false });
  });
});

describe('useHarborVulnerabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches without query string when no filters supplied', async () => {
    mockApi.get.mockResolvedValueOnce({
      vulnerabilities: [],
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        in_use_total: 0,
        in_use_critical: 0,
        fixable: 0,
        excepted: 0,
      },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborVulnerabilities(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/harbor/vulnerabilities');
  });

  it('serialises filter params and pagination into the URL', async () => {
    mockApi.get.mockResolvedValueOnce({
      vulnerabilities: [],
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        in_use_total: 0,
        in_use_critical: 0,
        fixable: 0,
        excepted: 0,
      },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useHarborVulnerabilities({
          severity: 'High',
          inUse: true,
          cveId: 'CVE-2024-1',
          repositoryName: 'library/nginx',
          limit: 50,
          offset: 25,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockApi.get.mock.calls[0][0];
    expect(calledUrl).toContain('/api/harbor/vulnerabilities?');
    expect(calledUrl).toContain('severity=High');
    expect(calledUrl).toContain('inUse=true');
    expect(calledUrl).toContain('cveId=CVE-2024-1');
    expect(calledUrl).toContain('repositoryName=library%2Fnginx');
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('offset=25');
  });

  it('serialises inUse=false explicitly', async () => {
    mockApi.get.mockResolvedValueOnce({
      vulnerabilities: [],
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        in_use_total: 0,
        in_use_critical: 0,
        fixable: 0,
        excepted: 0,
      },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborVulnerabilities({ inUse: false }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get.mock.calls[0][0]).toContain('inUse=false');
  });
});

describe('useHarborVulnerabilitySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the summary endpoint', async () => {
    const summary = {
      total: 5,
      critical: 1,
      high: 2,
      medium: 1,
      low: 1,
      in_use_total: 3,
      in_use_critical: 1,
      fixable: 4,
      excepted: 0,
    };
    mockApi.get.mockResolvedValueOnce(summary);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborVulnerabilitySummary(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/harbor/vulnerabilities/summary');
    expect(result.current.data).toEqual(summary);
  });
});

describe('useHarborExceptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to activeOnly=true', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborExceptions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/harbor/exceptions?activeOnly=true');
  });

  it('passes activeOnly=false when requested', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useHarborExceptions(false), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/harbor/exceptions?activeOnly=false');
  });
});

describe('useTriggerHarborSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('POSTs sync trigger and invalidates status immediately, vulnerabilities after delay', async () => {
    mockApi.post.mockResolvedValueOnce({ ok: true });

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useTriggerHarborSync(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/harbor/sync', {});
    // Status invalidates immediately
    expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual(
      expect.arrayContaining([['harbor-status']]),
    );

    // Vulnerabilities + summary invalidate after the 5s delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const allKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(allKeys).toEqual(
      expect.arrayContaining([
        ['harbor-vulnerabilities'],
        ['harbor-vulnerability-summary'],
      ]),
    );
  });
});

describe('useCreateException', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs payload and invalidates exceptions + vulnerabilities', async () => {
    mockApi.post.mockResolvedValueOnce({ id: 1 });

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateException(), { wrapper: Wrapper });

    const payload = {
      cve_id: 'CVE-2024-1',
      scope: 'image',
      justification: 'False positive',
    };
    await result.current.mutateAsync(payload);

    expect(mockApi.post).toHaveBeenCalledWith('/api/harbor/exceptions', payload);
    expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual(
      expect.arrayContaining([['harbor-exceptions'], ['harbor-vulnerabilities']]),
    );
  });
});

describe('useDeactivateException', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DELETEs the given id and invalidates exceptions cache', async () => {
    mockApi.delete.mockResolvedValueOnce({ ok: true });

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeactivateException(), { wrapper: Wrapper });

    await result.current.mutateAsync(42);

    expect(mockApi.delete).toHaveBeenCalledWith('/api/harbor/exceptions/42');
    expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual(
      expect.arrayContaining([['harbor-exceptions']]),
    );
  });
});
