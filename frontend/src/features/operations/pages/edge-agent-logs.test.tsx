import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EdgeAgentLogsPage from './edge-agent-logs';

const mockApiGet = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 0, setInterval: vi.fn() }),
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

describe('EdgeAgentLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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
      expect(
        screen.getByRole('heading', { name: 'Edge Agent Logs' }),
      ).toBeInTheDocument();

      // SkeletonText renders with role="status" + aria-label="Loading"
      await waitFor(() => {
        const loadingNodes = screen.getAllByRole('status', { name: 'Loading' });
        // edge-agent-logs renders three SkeletonText panes stacked while loading
        expect(loadingNodes.length).toBeGreaterThan(0);
      });

      // Stats cards (which only render with logs > 0) should be absent
      expect(screen.queryByText('Total Logs')).not.toBeInTheDocument();

      // Cleanup pending promise so React Query doesn't warn
      resolveQuery({ logs: [], total: 0 });
    });
  });

  describe('not-configured state (503)', () => {
    it('renders the configuration onboarding view when the API returns 503', async () => {
      mockApiGet.mockRejectedValue(new Error('HTTP 503'));

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText('Elasticsearch Not Configured'),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByRole('link', { name: /Configure Elasticsearch/i }),
      ).toBeInTheDocument();
      // Generic error block must NOT render in this branch
      expect(screen.queryByText('Failed to fetch logs')).not.toBeInTheDocument();
    });
  });

  describe('error state (non-503)', () => {
    it('shows the failure card and a retry button', async () => {
      mockApiGet.mockRejectedValue(new Error('HTTP 500: backend exploded'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch logs')).toBeInTheDocument();
      });

      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  describe('data state', () => {
    it('renders log rows, stats and the export button', async () => {
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

      // Stats card visible (only renders when logs > 0)
      expect(screen.getByText('Total Logs')).toBeInTheDocument();

      // Results header reflects count
      expect(screen.getByText(/Log Results/)).toBeInTheDocument();
      expect(screen.getByText(/2 of 2/)).toBeInTheDocument();

      // Export button appears once we have logs
      expect(
        screen.getByRole('button', { name: /Export/ }),
      ).toBeInTheDocument();
    });

    it('shows the empty state when API returns no logs', async () => {
      mockApiGet.mockResolvedValue({ logs: [], total: 0 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('No logs found')).toBeInTheDocument();
      });

      // Without logs, neither the stats grid nor the export button render
      expect(screen.queryByText('Total Logs')).not.toBeInTheDocument();
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
