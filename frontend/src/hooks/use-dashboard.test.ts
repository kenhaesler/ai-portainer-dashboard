import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDashboard } from './use-dashboard';

const mockUseQuery = vi.fn();
const mockUseAutoRefresh = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (...args: unknown[]) => mockUseAutoRefresh(...args),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

describe('useDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({});
    mockUseAutoRefresh.mockReturnValue({ interval: 30, enabled: true });
  });

  it('enables query only when authenticated with token', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, token: 'jwt-token' });

    useDashboard();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.enabled).toBe(true);
  });

  it('forces refetch on mount to recover when navigating back to home', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, token: 'jwt-token' });

    useDashboard();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchOnMount).toBe('always');
    expect(options.refetchInterval).toBe(30_000);
  });
});
