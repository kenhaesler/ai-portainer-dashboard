import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { useEndpointCapabilities, type Endpoint, type EdgeCapabilities } from './use-endpoints';

const mockApi = vi.mocked(api);

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 1,
    name: 'test-endpoint',
    type: 1,
    url: 'tcp://10.0.0.1:9001',
    status: 'up',
    containersRunning: 3,
    containersStopped: 1,
    containersHealthy: 2,
    containersUnhealthy: 0,
    totalContainers: 4,
    stackCount: 2,
    totalCpu: 4,
    totalMemory: 8589934592,
    isEdge: false,
    edgeMode: null,
    snapshotAge: null,
    checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useEndpointCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full capabilities for non-edge endpoint', async () => {
    mockApi.get.mockResolvedValue([makeEndpoint({ id: 1 })]);

    const { result } = renderHook(() => useEndpointCapabilities(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.endpoint).toBeDefined();
    });

    expect(result.current.isEdgeAsync).toBe(false);
    expect(result.current.capabilities).toEqual({
      exec: true,
      realtimeLogs: true,
      liveStats: true,
      immediateActions: true,
    });
  });

  it('returns full capabilities for Edge Standard endpoint', async () => {
    mockApi.get.mockResolvedValue([
      makeEndpoint({
        id: 2,
        isEdge: true,
        edgeMode: 'standard',
        capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
      }),
    ]);

    const { result } = renderHook(() => useEndpointCapabilities(2), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.endpoint).toBeDefined();
    });

    expect(result.current.isEdgeAsync).toBe(false);
    expect(result.current.capabilities.exec).toBe(true);
  });

  it('returns no capabilities and isEdgeAsync=true for Edge Async endpoint', async () => {
    const asyncCaps: EdgeCapabilities = {
      exec: false,
      realtimeLogs: false,
      liveStats: false,
      immediateActions: false,
    };

    mockApi.get.mockResolvedValue([
      makeEndpoint({
        id: 3,
        isEdge: true,
        edgeMode: 'async',
        capabilities: asyncCaps,
      }),
    ]);

    const { result } = renderHook(() => useEndpointCapabilities(3), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.endpoint).toBeDefined();
    });

    expect(result.current.isEdgeAsync).toBe(true);
    expect(result.current.capabilities).toEqual(asyncCaps);
  });

  it('returns full capabilities when endpoint is not found (safe default)', async () => {
    mockApi.get.mockResolvedValue([makeEndpoint({ id: 1 })]);

    const { result } = renderHook(() => useEndpointCapabilities(999), {
      wrapper: createWrapper(),
    });

    // Wait for query to settle
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    expect(result.current.isEdgeAsync).toBe(false);
    expect(result.current.capabilities.exec).toBe(true);
    expect(result.current.endpoint).toBeUndefined();
  });

  it('returns full capabilities when endpointId is undefined', async () => {
    mockApi.get.mockResolvedValue([]);

    const { result } = renderHook(() => useEndpointCapabilities(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.isEdgeAsync).toBe(false);
    expect(result.current.capabilities.exec).toBe(true);
  });
});
