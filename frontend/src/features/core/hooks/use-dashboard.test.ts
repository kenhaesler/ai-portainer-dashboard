import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDashboard } from './use-dashboard';
import { api } from '@/shared/lib/api';

const mockUseQuery = vi.fn();
const mockUseAutoRefresh = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (...args: unknown[]) => mockUseAutoRefresh(...args),
}));

describe('useDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({});
    mockUseAutoRefresh.mockReturnValue({ interval: 30, enabled: true });
    vi.spyOn(api, 'getToken').mockReturnValue('jwt-token');
  });

  it('enables query only when token is available', () => {
    useDashboard();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.enabled).toBe(true);
  });

  it('forces refetch on mount to recover when navigating back to home', () => {
    useDashboard();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchOnMount).toBe('always');
    expect(options.refetchInterval).toBe(30_000);
  });
});
