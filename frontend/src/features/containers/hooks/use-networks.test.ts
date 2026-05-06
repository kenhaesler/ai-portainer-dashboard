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
import { useNetworks, type Network } from './use-networks';

const mockApi = vi.mocked(api);

function makeNetwork(overrides: Partial<Network> = {}): Network {
  return {
    id: 'net-1',
    name: 'bridge',
    endpointId: 1,
    endpointName: 'prod',
    containers: [],
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

describe('useNetworks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches all networks when no endpointId is supplied', async () => {
    const networks = [makeNetwork(), makeNetwork({ id: 'net-2', name: 'host' })];
    mockApi.get.mockResolvedValueOnce(networks);

    const { result } = renderHook(() => useNetworks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/networks');
    expect(result.current.data).toEqual(networks);
  });

  it('passes endpointId in the query string when provided', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useNetworks(7), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/networks?endpointId=7');
  });

  it('returns empty array when no networks exist', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useNetworks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces fetch errors', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network unreachable'));

    const { result } = renderHook(() => useNetworks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
