import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import {
  useSecurityAudit,
  useSecurityIgnoreList,
  useUpdateSecurityIgnoreList,
} from './use-security-audit';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

describe('useSecurityAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches global audit when no endpointId is provided', async () => {
    mockApi.get.mockResolvedValueOnce({ entries: [] });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSecurityAudit(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/security/audit');
    expect(result.current.data).toEqual({ entries: [] });
  });

  it('fetches per-endpoint audit when endpointId is provided', async () => {
    const entries = [
      {
        containerId: 'c1',
        containerName: 'web',
        stackName: null,
        endpointId: 7,
        endpointName: 'prod',
        state: 'running',
        status: 'Up 2 days',
        image: 'nginx:latest',
        posture: { capAdd: [], privileged: false, networkMode: null, pidMode: null },
        findings: [],
        severity: 'none' as const,
        ignored: false,
      },
    ];
    mockApi.get.mockResolvedValueOnce({ entries });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSecurityAudit(7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/security/audit/7');
    expect(result.current.data?.entries).toHaveLength(1);
  });

  it('treats endpointId=0 as no filter (falsy guard)', async () => {
    mockApi.get.mockResolvedValueOnce({ entries: [] });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSecurityAudit(0), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The hook treats falsy endpointId as global — documents current behaviour.
    expect(mockApi.get).toHaveBeenCalledWith('/api/security/audit');
  });

  it('surfaces fetch errors', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('boom'));

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSecurityAudit(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSecurityIgnoreList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the ignore list', async () => {
    const ignoreList = {
      key: 'security.audit.ignore',
      category: 'security',
      defaults: ['internal-tool'],
      patterns: ['^test-'],
    };
    mockApi.get.mockResolvedValueOnce(ignoreList);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSecurityIgnoreList(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/security/ignore-list');
    expect(result.current.data).toEqual(ignoreList);
  });
});

describe('useUpdateSecurityIgnoreList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUTs new patterns and invalidates related caches on success', async () => {
    mockApi.put.mockResolvedValueOnce({ ok: true });

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateSecurityIgnoreList(), { wrapper: Wrapper });

    await result.current.mutateAsync(['^test-', '^staging-']);

    expect(mockApi.put).toHaveBeenCalledWith('/api/security/ignore-list', {
      patterns: ['^test-', '^staging-'],
    });
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        ['security-ignore-list'],
        ['security-audit'],
        ['dashboard', 'summary'],
      ]),
    );
  });
});
