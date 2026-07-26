import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Stub matchMedia for useReducedMotion / useCountUp in KpiCard
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const mockStats = {
  totalQueries: 142,
  totalTokens: 58300,
  avgLatencyMs: 1250,
  errorRate: 0.03,
  avgFeedbackScore: 4.2,
  feedbackCount: 37,
  modelBreakdown: [
    { model: 'llama3.2', count: 120, tokens: 48000 },
    { model: 'mistral', count: 22, tokens: 10300 },
  ],
};

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

// Timestamps are relative to now: the page narrows the newest-50 traces to the
// selected range, so fixed calendar dates would fall out of every window.
const mockTraces = [
  {
    id: 1,
    trace_id: 'tr-001',
    session_id: null,
    model: 'llama3.2',
    prompt_tokens: 150,
    completion_tokens: 250,
    total_tokens: 400,
    latency_ms: 1100,
    status: 'success',
    user_query: 'What containers are using the most memory?',
    response_preview: 'Based on the metrics...',
    created_at: isoMinutesAgo(10),
  },
  {
    id: 2,
    trace_id: 'tr-002',
    session_id: null,
    model: 'llama3.2',
    prompt_tokens: 100,
    completion_tokens: 0,
    total_tokens: 100,
    latency_ms: 500,
    status: 'error',
    user_query: 'Show CPU anomalies',
    response_preview: null,
    created_at: isoMinutesAgo(200),
  },
];

// Mock hooks
vi.mock('@/features/ai-intelligence/hooks/use-llm-observability', () => ({
  useLlmTraces: vi.fn().mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() }),
  useLlmStats: vi.fn().mockReturnValue({ data: null, isLoading: false, refetch: vi.fn() }),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: vi.fn().mockReturnValue({ interval: 0, setRefreshInterval: vi.fn(), setInterval: vi.fn() }),
}));

import { useLlmTraces, useLlmStats } from '@/features/ai-intelligence/hooks/use-llm-observability';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import LlmObservabilityPage, { tracesWithinWindow } from './llm-observability';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LlmObservabilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function withStats(stats: unknown) {
  vi.mocked(useLlmStats).mockReturnValue({
    data: stats,
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useLlmStats>);
}

function withTraces(traces: unknown[]) {
  vi.mocked(useLlmTraces).mockReturnValue({
    data: traces,
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useLlmTraces>);
}

// Every test starts from the same hook state — the file previously relied on
// mockReturnValue leaking between tests in declaration order.
beforeEach(() => {
  withStats(null);
  withTraces([]);
  vi.mocked(useAutoRefresh).mockReturnValue({
    interval: 0,
    setRefreshInterval: vi.fn(),
    setInterval: vi.fn(),
  } as unknown as ReturnType<typeof useAutoRefresh>);
});

describe('LlmObservabilityPage', () => {
  it('renders the page title through the shared PageHeader', () => {
    renderPage();
    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('LLM Observability');
  });

  // "Monitor LLM usage and performance" is the title as a verb phrase: delete
  // it and the operator loses nothing, so it is gone.
  it('carries no restated subtitle', () => {
    renderPage();
    expect(screen.queryByText('Monitor LLM usage and performance')).toBeNull();
    expect(screen.queryByTestId('page-header-subtitle')).toBeNull();
  });

  it('shows a range-scoped empty state when no traces exist', () => {
    renderPage();
    expect(screen.getByText('No LLM calls in the last 24h')).toBeTruthy();
    expect(screen.queryByText('No LLM traces yet')).toBeNull();
  });

  it('renders KPI cards with stats data', () => {
    withStats(mockStats);

    renderPage();
    expect(screen.getByText('Total Queries')).toBeTruthy();
    expect(screen.getByText('Total Tokens')).toBeTruthy();
    expect(screen.getByText('Avg Latency')).toBeTruthy();
    expect(screen.getByText('Error Rate')).toBeTruthy();
  });

  it('spaces the KPI cards with a gap-6 grid', () => {
    withStats(mockStats);

    const { container } = renderPage();
    // The KPI grid wraps the four metric cards; it must use the wider gap-6
    // spacing so the cards are not cramped together (gap-4 was too tight).
    const grids = container.querySelectorAll('div.grid.md\\:grid-cols-4');
    expect(grids.length).toBeGreaterThan(0);
    grids.forEach((grid) => {
      expect(grid.className).toContain('gap-6');
      expect(grid.className).not.toContain('gap-4');
    });
  });

  it('spaces the loading skeleton KPI grid with the same gap-6', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLlmStats>);

    const { container } = renderPage();
    const grid = container.querySelector('div.grid.md\\:grid-cols-4');
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain('gap-6');
    expect(grid?.className).not.toContain('gap-4');
  });

  it('renders model breakdown table with data', () => {
    withStats(mockStats);

    renderPage();
    expect(screen.getByText('Model Breakdown')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.getByText('llama3.2')).toBeTruthy();
    expect(screen.getByText('mistral')).toBeTruthy();
    expect(screen.getByLabelText('llama3.2 share')).toBeTruthy();
  });

  it('does not render feedback summary card', () => {
    withStats(mockStats);

    renderPage();
    expect(screen.queryByText('Feedback Summary')).toBeNull();
  });

  // Was a bare <p>No model data available.</p> — the only one of the page's
  // three empty states that bypassed the shared primitive.
  it('uses the shared EmptyState, naming the range, when no model data exists', () => {
    withStats({
      totalQueries: 10,
      totalTokens: 1200,
      avgLatencyMs: 700,
      errorRate: 0,
      avgFeedbackScore: null,
      feedbackCount: 0,
    });

    renderPage();
    expect(screen.getByText('Model Breakdown')).toBeTruthy();
    expect(screen.queryByText('No model data available.')).toBeNull();
    expect(screen.getByText('No model recorded in the last 24h')).toBeTruthy();
    expect(screen.getAllByTestId('empty-state-card').length).toBeGreaterThan(0);
  });

  it('renders traces table with data', () => {
    withStats(mockStats);
    withTraces(mockTraces);

    renderPage();
    expect(screen.getByText('What containers are using the most memory?')).toBeTruthy();
    expect(screen.getByText('Show CPU anomalies')).toBeTruthy();
    expect(screen.getByText('success')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('renders both shared DataTables when stats and traces have data', () => {
    withStats(mockStats);
    withTraces(mockTraces);

    renderPage();
    // Three shared DataTables on this page: Model Breakdown + Recent Traces (this
    // page), plus the embedded LlmLatencyBreakdown component, which became a
    // DataTable in its own migration (#1339).
    expect(screen.getAllByTestId('data-table')).toHaveLength(3);
    // No per-table search is rendered (all pass hideSearch)
    expect(screen.queryByTestId('data-table-search')).toBeNull();
  });

  it('blurs query column by default and reveals on toggle', () => {
    withTraces(mockTraces);

    renderPage();
    const queryCell = screen.getByText('What containers are using the most memory?');

    // Privacy mode is ON by default — the query cell content should have the blur class
    expect(queryCell.className).toContain('blur-sm');

    // Click the Privacy toggle button to reveal
    fireEvent.click(screen.getByText('Privacy'));
    expect(
      screen.getByText('What containers are using the most memory?').className
    ).not.toContain('blur-sm');

    // Click again to re-blur
    fireEvent.click(screen.getByText('Privacy'));
    expect(
      screen.getByText('What containers are using the most memory?').className
    ).toContain('blur-sm');
  });

  it('renders skeleton cards during loading', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLlmStats>);

    const { container } = renderPage();
    const skeletons = container.querySelectorAll('[role="status"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Design-critique fixes: the range selector drove half the page silently, the
// refresh dropdown scheduled nothing, and four tiles rendered a confident
// "Error Rate 0.0%" over zero calls.
// ---------------------------------------------------------------------------

describe('tracesWithinWindow', () => {
  it('drops traces older than the window', () => {
    const rows = [
      { created_at: isoMinutesAgo(10) },
      { created_at: isoMinutesAgo(200) },
    ] as Parameters<typeof tracesWithinWindow>[0];
    expect(tracesWithinWindow(rows, 1)).toHaveLength(1);
    expect(tracesWithinWindow(rows, 24)).toHaveLength(2);
  });

  it('keeps rows whose timestamp cannot be parsed rather than hiding a real call', () => {
    const rows = [{ created_at: 'not-a-date' }] as Parameters<typeof tracesWithinWindow>[0];
    expect(tracesWithinWindow(rows, 1)).toHaveLength(1);
  });
});

describe('time range drives the whole page', () => {
  it('narrows the traces table when the range shrinks to 1h', () => {
    withStats(mockStats);
    withTraces(mockTraces);

    renderPage();
    // Both rows visible at the default 24h.
    expect(screen.getByText('Show CPU anomalies')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '1h' }));

    // The 200-minute-old trace is outside the 1h window.
    expect(screen.queryByText('Show CPU anomalies')).toBeNull();
    expect(screen.getByText('What containers are using the most memory?')).toBeTruthy();
  });

  it('states the trace cap and the window next to the section heading', () => {
    withStats(mockStats);
    withTraces(mockTraces);

    renderPage();
    expect(screen.getByText('up to 50 newest, last 24h')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '6h' }));
    expect(screen.getByText('up to 50 newest, last 6h')).toBeTruthy();
  });

  it('passes the selected window down to the latency breakdown', () => {
    withStats(mockStats);

    renderPage();
    expect(screen.getByText(/per upstream provider, last 24h\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(screen.getByText(/per upstream provider, last 7d\./)).toBeTruthy();
  });
});

describe('auto-refresh control', () => {
  it('hands the hook an onTick so the interval actually schedules a fetch', () => {
    renderPage();
    const call = vi.mocked(useAutoRefresh).mock.calls[0];
    expect(call[0]).toBe(30);
    expect(typeof call[1]?.onTick).toBe('function');
  });

  it('refetches stats and traces when the tick fires', () => {
    const refetchStats = vi.fn();
    const refetchTraces = vi.fn();
    vi.mocked(useLlmStats).mockReturnValue({
      data: mockStats,
      isLoading: false,
      refetch: refetchStats,
    } as unknown as ReturnType<typeof useLlmStats>);
    vi.mocked(useLlmTraces).mockReturnValue({
      data: mockTraces,
      isLoading: false,
      refetch: refetchTraces,
    } as unknown as ReturnType<typeof useLlmTraces>);

    renderPage();
    const onTick = vi.mocked(useAutoRefresh).mock.calls[0][1]?.onTick;
    onTick?.();

    expect(refetchStats).toHaveBeenCalled();
    expect(refetchTraces).toHaveBeenCalled();
  });
});

describe('zero-traffic state', () => {
  it('collapses the four tiles to one line with a link to the assistant', () => {
    withStats({
      totalQueries: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      avgFeedbackScore: null,
      feedbackCount: 0,
      modelBreakdown: [],
    });

    renderPage();
    // "Error Rate 0.0%" over zero calls is undefined, not 0%.
    expect(screen.queryByText('Error Rate')).toBeNull();
    expect(screen.queryByText('0.0%')).toBeNull();

    const line = screen.getByTestId('llm-no-traffic');
    expect(line.textContent).toContain('No LLM calls in the last 24h');
    expect(within(line).getByRole('link', { name: 'Assistant' })).toHaveAttribute('href', '/assistant');
  });

  it('still renders the tiles once there is traffic', () => {
    withStats(mockStats);

    renderPage();
    expect(screen.queryByTestId('llm-no-traffic')).toBeNull();
    expect(screen.getByText('Error Rate')).toBeTruthy();
  });
});

describe('error rate tile', () => {
  it('does not put a downward trend arrow on a rising error rate', () => {
    withStats({ ...mockStats, errorRate: 0.12 });

    const { container } = renderPage();
    expect(screen.getByText('12.0%')).toBeTruthy();
    // The old tile rendered trend="down" — a green/red arrow whose direction
    // reads as "improving" on the one metric where down is good.
    expect(screen.queryByText('Above 5%')).toBeNull();
    expect(container.querySelector('.lucide-trending-down')).toBeNull();
    expect(screen.getByText(/above the 5% error threshold/i)).toBeTruthy();
  });
});
