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
import { useStacks, type Stack } from './use-stacks';

const mockApi = vi.mocked(api);

function makeStack(overrides: Partial<Stack> = {}): Stack {
  return {
    id: 1,
    name: 'web',
    type: 2,
    endpointId: 1,
    status: 'active',
    envCount: 0,
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

describe('useStacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches stacks from /api/stacks', async () => {
    const stacks = [makeStack({ id: 1, name: 'web' }), makeStack({ id: 2, name: 'worker' })];
    mockApi.get.mockResolvedValueOnce(stacks);

    const { result } = renderHook(() => useStacks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.get).toHaveBeenCalledWith('/api/stacks');
    expect(result.current.data).toEqual(stacks);
  });

  it('returns empty array when no stacks exist', async () => {
    mockApi.get.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useStacks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces fetch errors', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useStacks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('preserves stack source field for label-derived stacks', async () => {
    const stacks = [
      makeStack({ id: 1, source: 'portainer' }),
      makeStack({ id: 2, source: 'compose-label' }),
    ];
    mockApi.get.mockResolvedValueOnce(stacks);

    const { result } = renderHook(() => useStacks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].source).toBe('portainer');
    expect(result.current.data?.[1].source).toBe('compose-label');
  });
});
