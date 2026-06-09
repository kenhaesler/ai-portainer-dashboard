import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useSystemInfo } from './use-system-info';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';

const mockApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useSystemInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches component versions from /api/admin/system-info', async () => {
    mockApi.get.mockResolvedValue({ app: '2.0.0', node: '22.11.0', fastify: '5.8.5' });

    const { result } = renderHook(() => useSystemInfo(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi.get).toHaveBeenCalledWith('/api/admin/system-info');
    expect(result.current.data).toEqual({ app: '2.0.0', node: '22.11.0', fastify: '5.8.5' });
  });
});
