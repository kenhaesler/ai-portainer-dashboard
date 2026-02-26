import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEbpfCoverage, useEbpfCoverageSummary } from './use-ebpf-coverage';

const mockUseQuery = vi.fn();
const mockUsePageVisibility = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: vi.fn(() => ({ mutate: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/hooks/use-page-visibility', () => ({
  usePageVisibility: (...args: unknown[]) => mockUsePageVisibility(...args),
}));

describe('useEbpfCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({});
  });

  it('polls at 120s when page is visible', () => {
    mockUsePageVisibility.mockReturnValue(true);
    useEbpfCoverage();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchInterval).toBe(120_000);
  });

  it('stops polling when page is hidden', () => {
    mockUsePageVisibility.mockReturnValue(false);
    useEbpfCoverage();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchInterval).toBe(false);
  });
});

describe('useEbpfCoverageSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({});
  });

  it('polls at 120s when page is visible', () => {
    mockUsePageVisibility.mockReturnValue(true);
    useEbpfCoverageSummary();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchInterval).toBe(120_000);
  });

  it('stops polling when page is hidden', () => {
    mockUsePageVisibility.mockReturnValue(false);
    useEbpfCoverageSummary();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchInterval).toBe(false);
  });
});
