import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LogViewerPage from './log-viewer';

const mockUseQueries = vi.fn(() => []);
const mockUseUiStore = vi.fn((selector: (state: { potatoMode: boolean }) => boolean) =>
  selector({ potatoMode: false }),
);
const mockUsePageVisibility = vi.fn(() => true);

// Mutable URLSearchParams shared between useSearchParams calls so the
// test can simulate inbound deep-links from the trace explorer.
let mockUrlSearch = new URLSearchParams();
const mockSetSearchParams = vi.fn((updater: URLSearchParams | ((p: URLSearchParams) => URLSearchParams)) => {
  if (typeof updater === 'function') {
    mockUrlSearch = updater(new URLSearchParams(mockUrlSearch));
  } else {
    mockUrlSearch = updater;
  }
});

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockUrlSearch, mockSetSearchParams],
}));

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

vi.mock('@/shared/components/forms/container-multi-select', () => ({
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
    // `clearAllMocks` does not drop implementations set with `mockReturnValue`,
    // so restore the stream defaults explicitly — otherwise one test's streamed
    // entries leak into every test that follows it.
    mockUseLogStream.mockReturnValue({
      streamedEntries: [],
      isStreaming: false,
      isFallback: false,
      reset: vi.fn(),
    });
    mockUrlSearch = new URLSearchParams();
  });

  it('renders page shell and controls', () => {
    render(<LogViewerPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Log Viewer');
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Live tail' })).toBeInTheDocument();
    expect(screen.getByText('Select one or more containers to view aggregated logs.')).toBeInTheDocument();
  });

  it('renders exactly one h1, matching the navigation label', () => {
    render(<LogViewerPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  describe('toggles are switches with static labels', () => {
    it('keeps the label fixed and puts the state in aria-checked', () => {
      render(<LogViewerPage />);

      const wrap = screen.getByRole('switch', { name: 'Wrap lines' });
      expect(wrap).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(wrap);

      // Same accessible name after toggling — the state lives in aria-checked,
      // not in the label of the control that changes it.
      expect(screen.getByRole('switch', { name: 'Wrap lines' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.queryByText(/Wrap (ON|OFF)/)).not.toBeInTheDocument();
    });

    it('uses a light-theme-safe green for the on state, not text-emerald-300 alone', () => {
      render(<LogViewerPage />);
      const wrap = screen.getByRole('switch', { name: 'Wrap lines' });
      expect(wrap.className).toContain('text-emerald-700');
      expect(wrap.className).toContain('dark:text-emerald-300');
    });
  });

  describe('live tail requires a container', () => {
    it('is off and disabled with nothing selected', () => {
      render(<LogViewerPage />);

      const liveTail = screen.getByRole('switch', { name: 'Live tail' });
      expect(liveTail).toBeDisabled();
      expect(liveTail).toHaveAttribute('aria-checked', 'false');
      expect(liveTail).toHaveAttribute('title', 'Select a container to start a live tail');
    });

    it('turns on once a container is selected', async () => {
      render(<LogViewerPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select Container' }));

      await waitFor(() => {
        const liveTail = screen.getByRole('switch', { name: 'Live tail' });
        expect(liveTail).toBeEnabled();
        expect(liveTail).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('does not open a stream while nothing is selected', () => {
      render(<LogViewerPage />);
      const lastCall = mockUseLogStream.mock.calls.at(-1)?.[0] as
        | { enabled: boolean }
        | undefined;
      expect(lastCall?.enabled).toBe(false);
    });
  });

  describe('exports', () => {
    it('disables both export buttons while the console is empty', () => {
      render(<LogViewerPage />);

      expect(screen.getByRole('button', { name: /Export \.log/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Export \.json/ })).toBeDisabled();
      expect(screen.getByText('0 lines | 0 search matches')).toBeInTheDocument();
    });

    it('enables them once lines exist', async () => {
      mockUseLogStream.mockReturnValue({
        streamedEntries: [
          {
            id: 'e1',
            containerId: 'c1',
            containerName: 'api',
            timestamp: '2026-05-05T10:00:00.000Z',
            level: 'error' as const,
            message: 'connection refused',
            raw: '2026-05-05T10:00:00.000Z connection refused',
          },
        ],
        isStreaming: true,
        isFallback: false,
        reset: vi.fn(),
      });

      render(<LogViewerPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select Container' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Export \.log/ })).toBeEnabled();
      });
      expect(screen.getByRole('button', { name: /Export \.json/ })).toBeEnabled();
    });
  });

  describe('advanced filter disclosure', () => {
    it('hides Level, Trace ID and Buffer until Filters is opened', () => {
      render(<LogViewerPage />);

      expect(screen.queryByLabelText('Trace ID filter')).not.toBeInTheDocument();
      expect(screen.queryByText('Level')).not.toBeInTheDocument();
      expect(screen.queryByText('Buffer')).not.toBeInTheDocument();

      const disclosure = screen.getByRole('button', { name: /Filters/ });
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(disclosure);

      expect(screen.getByLabelText('Trace ID filter')).toBeInTheDocument();
      expect(screen.getByText('Level')).toBeInTheDocument();
      expect(screen.getByText('Buffer')).toBeInTheDocument();
      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens itself when a trace deep-link arrives', () => {
      mockUrlSearch = new URLSearchParams({ trace: 'abcdef1234567890' });
      render(<LogViewerPage />);

      expect(screen.getByRole('button', { name: /Filters/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByLabelText('Trace ID filter')).toBeInTheDocument();
    });
  });

  it('filter section has higher z-index than log output area (#404)', () => {
    const { container } = render(<LogViewerPage />);

    const filterSection = container.querySelector('section.z-20');
    expect(filterSection).toBeInTheDocument();
    // Canonical card pattern (no backdrop-blur) — verify the pane uses the
    // shared rounded-lg/border/shadow-sm aesthetic instead.
    expect(filterSection).toHaveClass('rounded-lg');
    expect(filterSection).toHaveClass('shadow-sm');

    const logSection = container.querySelector('section.z-10');
    expect(logSection).toBeInTheDocument();
    expect(logSection).toHaveClass('overflow-hidden');
  });

  it('defaults live tail to OFF in potato mode', () => {
    mockUseUiStore.mockImplementation((selector: (state: { potatoMode: boolean }) => boolean) =>
      selector({ potatoMode: true }),
    );

    render(<LogViewerPage />);

    expect(screen.getByRole('switch', { name: 'Live tail' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
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

  // ── Trace ↔ logs correlation (#1238) ───────────────────────────────────
  it('pre-populates trace filter from ?trace= URL param and shows banner', () => {
    mockUrlSearch = new URLSearchParams({ trace: 'abcdef1234567890', containerId: 'c1' });
    render(<LogViewerPage />);

    const traceInput = screen.getByLabelText('Trace ID filter') as HTMLInputElement;
    expect(traceInput.value).toBe('abcdef1234567890');
    expect(screen.getByTestId('trace-correlation-banner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable filter/i })).toBeInTheDocument();
  });

  it('clears the trace filter and URL params when "Disable filter" is clicked', () => {
    mockUrlSearch = new URLSearchParams({ trace: 'abcdef1234567890', from: '2026-05-14T11:00:00Z' });
    render(<LogViewerPage />);

    fireEvent.click(screen.getByRole('button', { name: /disable filter/i }));

    const traceInput = screen.getByLabelText('Trace ID filter') as HTMLInputElement;
    expect(traceInput.value).toBe('');
    expect(screen.queryByTestId('trace-correlation-banner')).not.toBeInTheDocument();
    expect(mockSetSearchParams).toHaveBeenCalled();
    expect(mockUrlSearch.has('trace')).toBe(false);
    expect(mockUrlSearch.has('from')).toBe(false);
  });

  it('does not render the banner when ?trace is absent', () => {
    render(<LogViewerPage />);
    expect(screen.queryByTestId('trace-correlation-banner')).not.toBeInTheDocument();
  });
});
