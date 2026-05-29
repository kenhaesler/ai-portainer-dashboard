import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LlmLatencyBreakdown } from './llm-latency-breakdown';

const mockApiGet = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (path: string, init?: { params?: Record<string, unknown> }) =>
      mockApiGet(path, init?.params),
  },
}));

// Suppress Recharts ResizeObserver / ResponsiveContainer noise in jsdom.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 600, height: 300 }}>
        {children}
      </div>
    ),
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LlmLatencyBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state callout when no spans are returned', async () => {
    // Mirror the real /api/traces shape — { traces: [] }.
    mockApiGet.mockResolvedValue({ traces: [] });

    renderWithProviders(<LlmLatencyBreakdown peers={['api.anthropic.com', 'api.openai.com']} />);

    await waitFor(() => {
      expect(screen.getByTestId('no-trace-data-callout')).toBeInTheDocument();
    });
  });

  it('renders a stacked bar per peer using p50/p95/p99 from the trace spans', async () => {
    mockApiGet.mockImplementation(async (_path: string, params: Record<string, unknown>) => {
      const host = params?.netPeerName as string;
      if (host === 'api.anthropic.com') {
        // Backend wraps the list as { traces: [...] }; the component unwraps.
        return {
          traces: [
            { traceId: 't1', duration: 1200, attributes: { 'x-trace-correlation-id': 'c1' } },
            { traceId: 't2', duration: 1100, attributes: {} },
            { traceId: 't3', duration: 1300, attributes: {} },
          ],
        };
      }
      if (host === 'api.openai.com') {
        return {
          traces: [
            { traceId: 't4', duration: 800, attributes: {} },
            { traceId: 't5', duration: 850, attributes: {} },
          ],
        };
      }
      return { traces: [] };
    });

    renderWithProviders(<LlmLatencyBreakdown peers={['api.anthropic.com', 'api.openai.com']} />);

    await waitFor(() => {
      // Headline label appears once data is present.
      expect(screen.getByText(/LLM latency breakdown/i)).toBeInTheDocument();
      // Both peer rows are present.
      expect(screen.getByText('api.anthropic.com')).toBeInTheDocument();
      expect(screen.getByText('api.openai.com')).toBeInTheDocument();
    });

    // 2 peers × 1 call each (parallel useQueries) — make sure both endpoints were hit
    const peers = mockApiGet.mock.calls.map((call) => call[1]?.netPeerName);
    expect(peers).toContain('api.anthropic.com');
    expect(peers).toContain('api.openai.com');
  });

  it('renders the breakdown via the shared DataTable with per-peer rows and columns', async () => {
    mockApiGet.mockImplementation(async (_path: string, params: Record<string, unknown>) => {
      const host = params?.netPeerName as string;
      if (host === 'api.anthropic.com') {
        return {
          traces: [
            { traceId: 't1', duration: 1200, attributes: {} },
            { traceId: 't2', duration: 1100, attributes: {} },
          ],
        };
      }
      return { traces: [] };
    });

    renderWithProviders(<LlmLatencyBreakdown peers={['api.anthropic.com']} />);

    await waitFor(() => {
      // The shared DataTable shell is mounted and the peer row has populated.
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
      // The peer is keyed as a DataTable row (getRowId => row.peer).
      expect(screen.getByTestId('table-row-api.anthropic.com')).toBeInTheDocument();
    });

    // Column headers are preserved.
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(screen.getByText('p50 (ms)')).toBeInTheDocument();
    expect(screen.getByText('p95 (ms)')).toBeInTheDocument();
    expect(screen.getByText('p99 (ms)')).toBeInTheDocument();

    // Calls cell reflects the two spans returned for the peer.
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
