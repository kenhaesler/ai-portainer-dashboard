import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LogViewerPage from './log-viewer';

const mockUseQueries = vi.fn(() => []);
const mockUseUiStore = vi.fn((selector: (state: { potatoMode: boolean }) => boolean) =>
  selector({ potatoMode: false }),
);
const mockUsePageVisibility = vi.fn(() => true);

vi.mock('@tanstack/react-query', () => ({
  useQueries: (args: unknown) => mockUseQueries(args),
}));

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (state: { potatoMode: boolean }) => boolean) => mockUseUiStore(selector),
}));

vi.mock('@/shared/hooks/use-page-visibility', () => ({
  usePageVisibility: () => mockUsePageVisibility(),
}));

const mockUseLogStream = vi.fn(() => ({
  streamedEntries: [],
  isStreaming: false,
  isFallback: false,
  reset: vi.fn(),
}));

vi.mock('@/features/observability/hooks/use-log-stream', () => ({
  useLogStream: (...args: unknown[]) => mockUseLogStream(...args),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({
    data: [{ id: 1, name: 'Local Docker' }],
  }),
}));

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: () => ({
    data: [{ id: 'c1', name: 'api', endpointId: 1, state: 'running', labels: {} }],
  }),
}));

vi.mock('@/shared/components/container-multi-select', () => ({
  ContainerMultiSelect: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['c1'])}>
      Select Container
    </button>
  ),
}));

describe('LogViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUiStore.mockImplementation((selector: (state: { potatoMode: boolean }) => boolean) =>
      selector({ potatoMode: false }),
    );
    mockUsePageVisibility.mockReturnValue(true);
  });

  it('renders page shell and controls', () => {
    render(<LogViewerPage />);
    expect(screen.getByText('Log Viewer')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Live Tail ON')).toBeInTheDocument();
    expect(screen.getByText('Select one or more containers to view aggregated logs.')).toBeInTheDocument();
  });

  it('filter section has higher z-index than log output area (#404)', () => {
    const { container } = render(<LogViewerPage />);

    const filterSection = container.querySelector('section.z-20');
    expect(filterSection).toBeInTheDocument();
    expect(filterSection).toHaveClass('backdrop-blur');

    const logSection = container.querySelector('section.z-10');
    expect(logSection).toBeInTheDocument();
    expect(logSection).toHaveClass('overflow-hidden');
  });

  it('defaults live tail to OFF in potato mode', () => {
    mockUseUiStore.mockImplementation((selector: (state: { potatoMode: boolean }) => boolean) =>
      selector({ potatoMode: true }),
    );

    render(<LogViewerPage />);

    expect(screen.getByText('Live Tail OFF')).toBeInTheDocument();
  });

  it('uses 5s fallback polling interval when SSE is unavailable (#519)', async () => {
    mockUseLogStream.mockReturnValue({
      streamedEntries: [],
      isStreaming: false,
      isFallback: true,
      reset: vi.fn(),
    });

    render(<LogViewerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Container' }));

    await waitFor(() => {
      const calls = mockUseQueries.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0] as { queries: Array<{ refetchInterval: number | false }> };
      expect(lastCall.queries).toHaveLength(1);
      expect(lastCall.queries[0]?.refetchInterval).toBe(5000);
    });
  });

  it('disables polling when SSE is streaming successfully', async () => {
    mockUseLogStream.mockReturnValue({
      streamedEntries: [],
      isStreaming: true,
      isFallback: false,
      reset: vi.fn(),
    });

    render(<LogViewerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Container' }));

    await waitFor(() => {
      const calls = mockUseQueries.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0] as { queries: Array<{ refetchInterval: number | false }> };
      expect(lastCall.queries).toHaveLength(1);
      expect(lastCall.queries[0]?.refetchInterval).toBe(false);
    });
  });

  it('pauses live-tail polling when tab is hidden', async () => {
    mockUsePageVisibility.mockReturnValue(false);

    render(<LogViewerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Container' }));

    await waitFor(() => {
      const calls = mockUseQueries.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0] as { queries: Array<{ refetchInterval: number | false }> };
      expect(lastCall.queries).toHaveLength(1);
      expect(lastCall.queries[0]?.refetchInterval).toBe(false);
    });
  });
});
