import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

vi.mock('@/features/observability/hooks/use-red', () => ({
  useRed: vi.fn(),
}));

vi.mock('@/features/observability/hooks/use-traces', () => ({
  useTraces: vi.fn(),
}));

// jsdom can't render Recharts ResponsiveContainer; stub it inline.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 800, height: 200 }}>
        {children}
      </div>
    ),
  };
});

import { useRed } from '@/features/observability/hooks/use-red';
import { useTraces } from '@/features/observability/hooks/use-traces';
import { ContainerTracesTab, LATENCY_SERIES, buildSparklineSeries } from './container-traces-tab';

const mockUseRed = vi.mocked(useRed);
const mockUseTraces = vi.mocked(useTraces);

function renderTab(containerName = 'web-1', endpointId = 1) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContainerTracesTab
          containerName={containerName}
          endpointId={endpointId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContainerTracesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state callout when RED data has no rows', () => {
    mockUseRed.mockReturnValue({ data: { buckets: [], truncated: false } } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab();

    expect(screen.getByTestId('no-trace-data-callout')).toBeInTheDocument();
  });

  it('renders the three panels when RED data is present', () => {
    mockUseRed.mockReturnValue({
      data: {
        buckets: [
          {
            bucketStart: '2026-05-14T11:00:00.000Z',
            rows: [
              {
                group: 'web-1',
                rate: 1.5,
                errorRate: 0.02,
                p50Ms: 10,
                p95Ms: 60,
                p99Ms: 120,
                callCount: 5400,
              },
            ],
          },
        ],
        truncated: false,
      },
    } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab();

    expect(screen.getByText(/RED summary/i)).toBeInTheDocument();
    expect(screen.getByText(/Slowest calls \(last 1h\)/i)).toBeInTheDocument();
    // The two direction-labelled panels issued identical queries and rendered
    // identical rows; one honest panel replaces them.
    expect(screen.queryByText(/Top outgoing calls/i)).toBeNull();
    expect(screen.queryByText(/Top incoming calls/i)).toBeNull();
    expect(screen.getByText(/Latency.*timeline|sparkline|over time/i)).toBeInTheDocument();
    // Rate shown
    expect(screen.getByText(/1\.50.*\/s/)).toBeInTheDocument();
    // Error rate (2.00%)
    expect(screen.getByText(/2\.00%/)).toBeInTheDocument();
    // p95 displayed in ms
    expect(screen.getByText(/60.*ms/)).toBeInTheDocument();
  });

  it('calls useRed twice: once for the summary (1h bucket) and once for the sparkline (1m bucket)', () => {
    mockUseRed.mockReturnValue({ data: { buckets: [], truncated: false } } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab('web-1');

    // Confirm useRed was called for both bucket sizes
    const bucketsPassed = mockUseRed.mock.calls.map((c) => c[0].bucket);
    expect(bucketsPassed).toContain('1h');
    expect(bucketsPassed).toContain('1m');
    // Both filtered by container
    for (const [opts] of mockUseRed.mock.calls) {
      expect(opts.container).toBe('web-1');
    }
  });

  it('issues one traces query, filtered by container name', () => {
    mockUseRed.mockReturnValue({ data: { buckets: [], truncated: false } } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab('api-2');

    const calls = mockUseTraces.mock.calls.map(([opts]) => opts);
    // The second, identical query backed a panel that duplicated the first.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.containerName).toBe('api-2');
  });

  it('renders call rows with deep links to /traces?trace=…', () => {
    mockUseRed.mockReturnValue({
      data: {
        buckets: [
          {
            bucketStart: '2026-05-14T11:00:00.000Z',
            rows: [
              {
                group: 'web-1', rate: 1, errorRate: 0,
                p50Ms: 5, p95Ms: 10, p99Ms: 15, callCount: 3,
              },
            ],
          },
        ],
        truncated: false,
      },
    } as any);
    mockUseTraces.mockReturnValue({
      data: [
        {
          traceId: 't1', services: ['web-1'], startTime: '2026-05-14T11:00:00Z',
          duration: 12, status: 'ok',
          rootSpan: {
            traceId: 't1', spanId: 's1', operationName: 'GET /foo',
            serviceName: 'web-1', startTime: '2026-05-14T11:00:00Z',
            duration: 12, status: 'ok',
          },
          spans: [],
        },
      ],
    } as any);

    renderTab('web-1');

    const link = screen.getAllByRole('link', { name: /GET \/foo/i })[0];
    expect(link.getAttribute('href')).toMatch(/\/traces\?.*trace=t1/);
  });

  describe('missing samples (invariant #7)', () => {
    const rowFor = (overrides: Record<string, unknown>) => ({
      group: 'web-1',
      rate: 1.5,
      errorRate: 0.02,
      p50Ms: 10,
      p95Ms: 60,
      p99Ms: 120,
      callCount: 5400,
      ...overrides,
    });

    it('renders a dash and a qualifier, never "0 ms", for null percentiles', () => {
      mockUseRed.mockReturnValue({
        data: {
          buckets: [{
            bucketStart: '2026-05-14T11:00:00.000Z',
            rows: [rowFor({ p50Ms: null, p95Ms: null, p99Ms: null })],
          }],
          truncated: false,
        },
      } as any);
      mockUseTraces.mockReturnValue({ data: [] } as any);

      renderTab('web-1');

      for (const label of ['p50', 'p95', 'p99']) {
        const cell = screen.getByText(label).closest('div') as HTMLElement;
        expect(cell).toHaveTextContent('—');
        expect(cell).toHaveTextContent('no samples in range');
        expect(cell.textContent).not.toMatch(/\b0\s*ms/);
      }
      // The measured fields next to them are untouched.
      expect(screen.getByText(/1\.50.*\/s/)).toBeInTheDocument();
      expect(screen.getByText(/2\.00%/)).toBeInTheDocument();
    });

    it('renders a dash for a null rate / error rate instead of 0.00%', () => {
      mockUseRed.mockReturnValue({
        data: {
          buckets: [{
            bucketStart: '2026-05-14T11:00:00.000Z',
            rows: [rowFor({ rate: null, errorRate: null })],
          }],
          truncated: false,
        },
      } as any);
      mockUseTraces.mockReturnValue({ data: [] } as any);

      renderTab('web-1');

      const errorCell = screen.getByText('Error rate').closest('div') as HTMLElement;
      expect(errorCell).toHaveTextContent('—');
      expect(errorCell.textContent).not.toMatch(/0\.00%/);
      const rateCell = screen.getByText('Rate').closest('div') as HTMLElement;
      expect(rateCell).toHaveTextContent('—');
      expect(rateCell.textContent).not.toMatch(/0\.00/);
    });

    it('never borrows another container\'s row for the timeline', () => {
      mockUseRed.mockImplementation(((opts: { bucket: string }) => ({
        data: opts.bucket === '1h'
          ? { buckets: [{ bucketStart: '2026-05-14T11:00:00.000Z', rows: [rowFor({})] }], truncated: false }
          // The 1m window holds only a *different* container's samples.
          : { buckets: [{ bucketStart: '2026-05-14T11:05:00.000Z', rows: [rowFor({ group: 'other-9', p50Ms: 999 })] }], truncated: false },
      })) as any);
      mockUseTraces.mockReturnValue({ data: [] } as any);

      renderTab('web-1');

      // Summary is real; the timeline has no data for web-1 and says so rather
      // than plotting other-9's 999 ms as web-1's latency.
      expect(screen.getByText(/1\.50.*\/s/)).toBeInTheDocument();
      expect(screen.getAllByTestId('no-trace-data-callout')).toHaveLength(1);
      expect(screen.queryByTestId('responsive-container')).toBeNull();
    });
  });

  describe('buildSparklineSeries (invariant #7)', () => {
    const bucket = (bucketStart: string, rows: Array<Record<string, unknown>>) =>
      ({ bucketStart, rows }) as any;
    const row = (overrides: Record<string, unknown>) =>
      ({ group: 'web-1', rate: 1, errorRate: 0.1, p50Ms: 10, p95Ms: 50, p99Ms: 90, callCount: 4, ...overrides });

    it('plots null percentiles as null (a gap), not 0', () => {
      const series = buildSparklineSeries(
        [bucket('2026-05-14T11:00:00.000Z', [row({ p50Ms: null, p95Ms: null, errorRate: null })])],
        'web-1',
      );
      expect(series).toHaveLength(1);
      expect(series[0]).toMatchObject({ p50: null, p95: null, errorRate: null });
    });

    it('converts a known error rate to a percentage and keeps a real zero', () => {
      const series = buildSparklineSeries(
        [bucket('2026-05-14T11:00:00.000Z', [row({ errorRate: 0.25, p50Ms: 0 })])],
        'web-1',
      );
      expect(series[0]).toMatchObject({ errorRate: 25, p50: 0 });
    });

    it('drops a bucket that has no row for this container instead of using rows[0]', () => {
      const series = buildSparklineSeries(
        [
          bucket('2026-05-14T11:00:00.000Z', [row({ group: 'other-9', p50Ms: 999 })]),
          bucket('2026-05-14T11:01:00.000Z', [row({ p50Ms: 7 })]),
        ],
        'web-1',
      );
      expect(series).toHaveLength(1);
      expect(series[0]?.p50).toBe(7);
    });
  });

  it('draws the latency series with theme tokens, not hardcoded hex', () => {
    // Recharts lays out nothing in jsdom (zero-size container), so assert the
    // shipped series definition the chart renders from.
    expect(LATENCY_SERIES.map((s) => s.dataKey)).toEqual(['p50', 'p95', 'errorRate']);
    for (const series of LATENCY_SERIES) {
      expect(series.stroke).toMatch(/^var\(--color-/);
    }
    // p95 must not borrow purple, which is reserved for AI insight.
    expect(LATENCY_SERIES.find((s) => s.dataKey === 'p95')?.stroke).toBe('var(--color-chart-2)');
    expect(LATENCY_SERIES.find((s) => s.dataKey === 'errorRate')?.stroke).toBe('var(--color-destructive)');
  });
});
