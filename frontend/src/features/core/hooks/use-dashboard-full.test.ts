import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDashboardFull } from './use-dashboard-full';
import { api } from '@/lib/api';

const mockUseQuery = vi.fn();
const mockUseQueryClient = vi.fn();
const mockUseAutoRefresh = vi.fn();
const mockSetQueryData = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: () => mockUseQueryClient(),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (...args: unknown[]) => mockUseAutoRefresh(...args),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useEffect: vi.fn((fn: () => void) => fn()),
  };
});

describe('useDashboardFull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAutoRefresh.mockReturnValue({ interval: 30, enabled: true });
    mockUseQueryClient.mockReturnValue({ setQueryData: mockSetQueryData });
    vi.spyOn(api, 'getToken').mockReturnValue('jwt-token');
  });

  it('enables query only when token is available', () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    useDashboardFull();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.enabled).toBe(true);
  });

  it('uses correct query key with topN parameter', () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    useDashboardFull(5);

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.queryKey).toEqual(['dashboard', 'full', 5]);
  });

  it('populates individual caches when data arrives', () => {
    const fullData = {
      summary: { kpis: { endpoints: 1 }, security: {}, recentContainers: [], timestamp: '' },
      resources: { fleetCpuPercent: 50, fleetMemoryPercent: 60, topStacks: [] },
      endpoints: [{ id: 1, name: 'local' }],
    };

    mockUseQuery.mockReturnValue({ data: fullData });
    useDashboardFull(10);

    expect(mockSetQueryData).toHaveBeenCalledWith(['dashboard', 'summary'], fullData.summary);
    expect(mockSetQueryData).toHaveBeenCalledWith(['dashboard', 'resources', 10], fullData.resources);
    expect(mockSetQueryData).toHaveBeenCalledWith(['endpoints'], fullData.endpoints);
  });

  it('does not populate caches when data is undefined', () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    useDashboardFull();

    expect(mockSetQueryData).not.toHaveBeenCalled();
  });

  it('sets refetchInterval based on auto-refresh settings', () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    mockUseAutoRefresh.mockReturnValue({ interval: 60, enabled: true });
    useDashboardFull();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchInterval).toBe(60_000);
  });

  it('disables refetchInterval when auto-refresh is off', () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    mockUseAutoRefresh.mockReturnValue({ interval: 30, enabled: false });
    useDashboardFull();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchInterval).toBe(false);
  });
});
