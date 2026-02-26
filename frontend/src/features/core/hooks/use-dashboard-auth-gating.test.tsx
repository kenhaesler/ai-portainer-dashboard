import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryProvider } from '@/providers/query-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { useDashboard } from '@/hooks/use-dashboard';
import { api } from '@/lib/api';

function createJwtWithFutureExpiry(): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${payload}.signature`;
}

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    );
  };
}

describe('useDashboard auth gating', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    api.setToken(null);
  });

  it('does not fetch dashboard data before authentication is available', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({
      kpis: {
        endpoints: 0,
        endpointsUp: 0,
        endpointsDown: 0,
        running: 0,
        stopped: 0,
        healthy: 0,
        unhealthy: 0,
        total: 0,
        stacks: 0,
      },
      security: { totalAudited: 0, flagged: 0, ignored: 0 },
      endpoints: [],
      recentContainers: [],
      timestamp: new Date().toISOString(),
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('fetches dashboard data immediately when a valid stored token exists', async () => {
    window.localStorage.setItem('auth_token', createJwtWithFutureExpiry());
    window.localStorage.setItem('auth_username', 'admin');
    window.localStorage.setItem('auth_role', 'admin');

    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({
      kpis: {
        endpoints: 1,
        endpointsUp: 1,
        endpointsDown: 0,
        running: 2,
        stopped: 0,
        healthy: 2,
        unhealthy: 0,
        total: 2,
        stacks: 1,
      },
      security: { totalAudited: 0, flagged: 0, ignored: 0 },
      endpoints: [],
      recentContainers: [],
      timestamp: new Date().toISOString(),
    });

    renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/dashboard/summary');
    });
  });
});
