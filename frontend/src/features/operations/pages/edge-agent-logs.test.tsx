import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api-error';
import EdgeAgentLogsPage from './edge-agent-logs';

const mockApiGet = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

/**
 * The real hook is used in the auto-refresh tests further down (it owns the
 * timer), so this mock is applied per-test via `vi.doMock`-style overrides
 * instead of globally. Here it just pins the control to "off".
 */
const mockUseAutoRefresh = vi.fn(() => ({
  interval: 0,
  setRefreshInterval: vi.fn(),
  setInterval: vi.fn(),
  enabled: false,
  toggle: vi.fn(),
  options: [0, 15, 30, 60, 120, 300],
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (...args: unknown[]) => mockUseAutoRefresh(...(args as [])),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EdgeAgentLogsPage />
    </QueryClientProvider>,
  );
}

/** The server's real 503 body — note it contains no "503" anywhere. */
const NOT_CONFIGURED_BODY =
  'Configure Elasticsearch in Settings or set KIBANA_ENDPOINT environment variable';

describe('EdgeAgentLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('page header', () => {
    it('renders one h1 matching the navigation label, in the loading branch too', async () => {
      let resolveQuery!: (v: unknown) => void;
      mockApiGet.mockReturnValue(
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
      );

      renderPage();

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Edge Logs');

      resolveQuery({ logs: [], total: 0 });
      await waitFor(() => expect(screen.getByText('No logs found')).toBeInTheDocument());
    });

    it('keeps the same h1 on the not-configured branch', async () => {
      mockApiGet.mockRejectedValue(new ApiError(503, NOT_CONFIGURED_BODY));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Elasticsearch not configured')).toBeInTheDocument();
      });
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Edge Logs');
    });
  });

  describe('loading state', () => {
    it('shows skeleton placeholders while the logs query is in flight', async () => {
      // Long-pending promise — never resolves during the assertion window
      let resolveQuery!: (v: unknown) => void;
      mockApiGet.mockReturnValue(
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
      );

      renderPage();

      // Heading is always present
      expect(screen.getByRole('heading', { name: 'Edge Logs' })).toBeInTheDocument();

      // SkeletonText renders with role="status" + aria-label="Loading"
      await waitFor(() => {
        const loadingNodes = screen.getAllByRole('status', { name: 'Loading' });
        // edge-agent-logs renders three SkeletonText panes stacked while loading
        expect(loadingNodes.length).toBeGreaterThan(0);
      });

      // The level summary (which only renders with logs > 0) should be absent
      expect(screen.queryByText(/lines/)).not.toBeInTheDocument();

      // Cleanup pending promise so React Query doesn't warn
      resolveQuery({ logs: [], total: 0 });
    });
  });

  describe('not-configured state (503)', () => {
    // Regression: the branch used to test `error.message.includes('503')`, but
    // `ApiError.message` is the server's body text, which never contains the
    // status code. The whole setup panel was unreachable.
    it('renders the setup panel for a 503 whose message does not contain "503"', async () => {
      mockApiGet.mockRejectedValue(new ApiError(503, NOT_CONFIGURED_BODY));

      expect(NOT_CONFIGURED_BODY).not.toContain('503');

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Elasticsearch not configured')).toBeInTheDocument();
      });

      expect(
        screen.getByRole('link', { name: /Configure Elasticsearch/i }),
      ).toBeInTheDocument();
      // Generic error block must NOT render in this branch
      expect(screen.queryByText('Failed to fetch logs')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('deep-links to the Integrations settings tab and names the legacy env var', async () => {
      mockApiGet.mockRejectedValue(new ApiError(503, NOT_CONFIGURED_BODY));

      renderPage();

      const link = await screen.findByRole('link', { name: /Configure Elasticsearch/i });
      expect(link).toHaveAttribute('href', '/settings?tab=integrations');
      expect(screen.getByText('KIBANA_ENDPOINT')).toBeInTheDocument();
      // "Kibana" must not be presented as a second product to configure
      expect(screen.queryByText(/Elasticsearch or Kibana/)).not.toBeInTheDocument();
    });

    it('does not poll while unconfigured', async () => {
      // Drive the real timer through the hook's `onTick`, which the page gates
      // on `isNotConfigured` so a 503 does not re-fail every N seconds.
      const ticks: Array<() => void> = [];
      mockUseAutoRefresh.mockImplementation(((
        _default: number,
        opts?: { onTick?: () => void },
      ) => {
        if (opts?.onTick) ticks.push(opts.onTick);
        return {
          interval: 15,
          setRefreshInterval: vi.fn(),
          setInterval: vi.fn(),
          enabled: true,
          toggle: vi.fn(),
          options: [0, 15, 30, 60, 120, 300],
        };
      }) as never);

      mockApiGet.mockRejectedValue(new ApiError(503, NOT_CONFIGURED_BODY));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Elasticsearch not configured')).toBeInTheDocument();
      });

      const callsBefore = mockApiGet.mock.calls.length;
      act(() => {
        ticks[ticks.length - 1]?.();
      });
      await Promise.resolve();
      expect(mockApiGet.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('error state (non-503)', () => {
    it('shows the failure card and a retry button', async () => {
      mockApiGet.mockRejectedValue(new ApiError(500, 'backend exploded'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch logs')).toBeInTheDocument();
      });

      expect(screen.getByText(/backend exploded/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      // The setup panel is for 503 only
      expect(screen.queryByText('Elasticsearch not configured')).not.toBeInTheDocument();
    });
  });

  describe('data state', () => {
    it('renders log rows, the level summary and the export button', async () => {
      mockApiGet.mockResolvedValue({
        logs: [
          {
            id: '1',
            timestamp: '2026-05-05T10:00:00Z',
            message: 'connection refused',
            hostname: 'edge-01',
            level: 'error',
            source: { raw: 'log line' },
          },
          {
            id: '2',
            timestamp: '2026-05-05T10:01:00Z',
            message: 'starting agent',
            hostname: 'edge-02',
            level: 'info',
            source: { raw: 'log line 2' },
          },
        ],
        total: 2,
      });

      renderPage();

      // Wait for log row content
      await waitFor(() => {
        expect(screen.getByText('connection refused')).toBeInTheDocument();
      });
      expect(screen.getByText('starting agent')).toBeInTheDocument();

      // One distribution line + bar, not five KPI tiles
      expect(screen.getByText('2 lines')).toBeInTheDocument();
      expect(screen.getByText('1 error')).toBeInTheDocument();
      expect(screen.getByText('1 info')).toBeInTheDocument();
      expect(screen.queryByText('Total Logs')).not.toBeInTheDocument();
      expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: '1 error, 1 info' })).toBeInTheDocument();

      // Results header reflects count
      expect(screen.getByText(/Log Results/)).toBeInTheDocument();
      expect(screen.getByText(/2 of 2/)).toBeInTheDocument();

      // Export button appears once we have logs
      expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
    });

    it('names the total when the server has more matches than it returned', async () => {
      mockApiGet.mockResolvedValue({
        logs: [
          {
            id: '1',
            timestamp: '2026-05-05T10:00:00Z',
            message: 'a line',
            hostname: 'edge-01',
            level: 'debug',
            source: {},
          },
        ],
        total: 4212,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('1 of 4,212 lines')).toBeInTheDocument();
      });
      // debug is neutral, never a green pass indicator
      expect(screen.getByText('1 debug')).toHaveClass('text-muted-foreground');
    });

    it('shows the empty state when API returns no logs', async () => {
      mockApiGet.mockResolvedValue({ logs: [], total: 0 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('No logs found')).toBeInTheDocument();
      });

      // Without logs, neither the level summary nor the export button render
      expect(screen.queryByText(/^0 lines$/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Export/ }),
      ).not.toBeInTheDocument();
    });

    it('expands a log row when the row is clicked', async () => {
      mockApiGet.mockResolvedValue({
        logs: [
          {
            id: 'log-1',
            timestamp: '2026-05-05T10:00:00Z',
            message: 'expandable message',
            hostname: 'edge-01',
            level: 'warn',
            source: { detail: 'extended trace' },
          },
        ],
        total: 1,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('expandable message')).toBeInTheDocument();
      });

      // Click the row to expand
      fireEvent.click(screen.getByText('expandable message'));

      // The expanded panel renders the JSON-stringified source
      expect(screen.getByText('Full Log Entry')).toBeInTheDocument();
      expect(screen.getByText(/extended trace/)).toBeInTheDocument();
    });
  });
});
