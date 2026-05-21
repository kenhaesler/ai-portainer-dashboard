import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDiscoveredOidcGroups } from './use-discovered-oidc-groups';
import { api } from '@/shared/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: { get: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDiscoveredOidcGroups', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('fetches discovered groups when enabled', async () => {
    vi.mocked(api.get).mockResolvedValue({
      groups: [{ group_name: 'Admins', user_count: 2, last_seen_at: '2026-05-20T10:00:00.000Z' }],
    });

    const { result } = renderHook(() => useDiscoveredOidcGroups({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { group_name: 'Admins', user_count: 2, last_seen_at: '2026-05-20T10:00:00.000Z' },
    ]);
    expect(api.get).toHaveBeenCalledWith('/api/auth/oidc/discovered-groups');
  });

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useDiscoveredOidcGroups({ enabled: false }), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });

  it('returns an empty array on fetch failure (graceful fallback)', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('500'));

    const { result } = renderHook(() => useDiscoveredOidcGroups({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
