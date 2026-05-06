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
import { useContainerDetail } from './use-container-detail';
import type { Container } from './use-containers';

const mockApi = vi.mocked(api);

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'fullsha1234567890abcdef',
    name: 'web',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 days',
    endpointId: 1,
    endpointName: 'prod',
    ports: [],
    created: 0,
    labels: {},
    networks: [],
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

describe('useContainerDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the container matching the full id', async () => {
    const target = makeContainer({ id: 'aaaaaaaaaaaaaaaa', name: 'target' });
    mockApi.get.mockResolvedValueOnce([target, makeContainer({ id: 'bbbbbbbbbbbbbbbb' })]);

    const { result } = renderHook(() => useContainerDetail(1, 'aaaaaaaaaaaaaaaa'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(target);
    expect(result.current.isError).toBe(false);
  });

  it('matches a container by id prefix (short id)', async () => {
    const full = makeContainer({ id: 'abcd1234efgh5678', name: 'prefixed' });
    mockApi.get.mockResolvedValueOnce([full]);

    const { result } = renderHook(() => useContainerDetail(1, 'abcd1234'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.name).toBe('prefixed');
  });

  it('flags isError=true when no container matches and loading completes', async () => {
    mockApi.get.mockResolvedValueOnce([makeContainer({ id: 'aaaaaaaa' })]);

    const { result } = renderHook(() => useContainerDetail(1, 'doesnotexist'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(true);
  });

  it('passes endpointId through to the underlying useContainers query', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    renderHook(() => useContainerDetail(42, 'whatever'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(mockApi.get).toHaveBeenCalledWith('/api/containers?endpointId=42');
  });

  it('propagates fetch errors', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(() => useContainerDetail(1, 'x'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
