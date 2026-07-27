import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

function renderWithRouter(ui: ReactElement, route: string = '/traces') {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

const mockUseAutoRefresh = vi.fn(() => ({ interval: 0, setRefreshInterval: vi.fn(), setInterval: vi.fn() }));
vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (...args: unknown[]) => mockUseAutoRefresh(...(args as [])),
}));

// jsdom reports every element as 0px tall, so a real virtualizer would render
// nothing. Same shape as the log viewer / data-table tests.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 128,
        end: (i + 1) * 128,
        size: 128,
        key: i,
      })),
    getTotalSize: () => count * 128,
    measureElement: vi.fn(),
  })),
}));

vi.mock('@/shared/components/charts/service-map', () => ({
  ServiceMap: () => <div>mock-service-map</div>,
}));

vi.mock('@/shared/components/ui/themed-select', () => ({
  ThemedSelect: ({ value, options, onValueChange, className }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    className?: string;
  }) => (
    <select className={className} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const mockUseTraces = vi.fn();
const mockUseTrace = vi.fn();
const mockUseServiceMap = vi.fn();
const mockUseTraceSummary = vi.fn();

vi.mock('@/features/observability/hooks/use-traces', () => ({
  useTraces: (...args: unknown[]) => mockUseTraces(...args),
  useTrace: (...args: unknown[]) => mockUseTrace(...args),
  useServiceMap: (...args: unknown[]) => mockUseServiceMap(...args),
  useTraceSummary: (...args: unknown[]) => mockUseTraceSummary(...args),
}));

import TraceExplorerPage, {
  ANOMALY_Z_THRESHOLD,
  computeDurationStats,
  constantValue,
  durationZScore,
  isPreflightOperation,
  percentile,
} from './trace-explorer';

interface TraceFixture {
  trace_id: string;
  root_span: string;
  duration_ms: number;
  status: string;
  service_name: string;
  start_time: string;
  trace_source: string;
  span_count: number;
  http_route: string;
  container_name?: string;
}

/** 11 fast GETs, one 5s outlier (z ≈ 3.3) and three CORS preflights. */
function buildTraces(): TraceFixture[] {
  const fast: TraceFixture[] = Array.from({ length: 11 }, (_, i) => ({
    trace_id: `fast-${i}`,
    root_span: `GET /health/${i}`,
    duration_ms: 10,
    status: 'ok',
    service_name: 'api-gateway',
    start_time: '2026-02-12T10:00:00.000Z',
    trace_source: 'http',
    span_count: 1,
    http_route: `/health/${i}`,
  }));
  const slow: TraceFixture = {
    trace_id: 'slow-1',
    root_span: 'GET /reports/export',
    duration_ms: 5000,
    status: 'ok',
    service_name: 'api-gateway',
    start_time: '2026-02-12T10:00:00.000Z',
    trace_source: 'http',
    span_count: 1,
    http_route: '/reports/export',
  };
  const preflights: TraceFixture[] = Array.from({ length: 3 }, (_, i) => ({
    trace_id: `preflight-${i}`,
    root_span: 'OPTIONS *',
    duration_ms: 4,
    status: 'ok',
    service_name: 'api-gateway',
    start_time: '2026-02-12T10:00:00.000Z',
    trace_source: 'http',
    span_count: 1,
    http_route: '*',
  }));
  return [...fast, slow, ...preflights];
}

describe('trace duration statistics', () => {
  it('takes the nearest-rank percentile', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
  });

  it('computes p50/p95 plus the mean and stddev the z-score uses', () => {
    const stats = computeDurationStats([10, 10, 10, 10, 50]);
    expect(stats.count).toBe(5);
    expect(stats.p50).toBe(10);
    expect(stats.p95).toBe(50);
    expect(stats.mean).toBe(18);
    expect(stats.stdDev).toBeCloseTo(16, 5);
  });

  it('returns no z-score for a flat or single-sample window', () => {
    expect(durationZScore(10, computeDurationStats([10, 10, 10]))).toBeNull();
    expect(durationZScore(10, computeDurationStats([10]))).toBeNull();
  });

  it('flags the outlier at the detector threshold', () => {
    const durations = [...Array.from({ length: 11 }, () => 10), 5000];
    const stats = computeDurationStats(durations);
    expect(durationZScore(5000, stats)).toBeGreaterThanOrEqual(ANOMALY_Z_THRESHOLD);
    expect(durationZScore(10, stats)).toBeLessThan(ANOMALY_Z_THRESHOLD);
  });

  it('recognises CORS preflights by operation name', () => {
    expect(isPreflightOperation('OPTIONS *')).toBe(true);
    expect(isPreflightOperation('  options /api/x ')).toBe(true);
    expect(isPreflightOperation('GET /options-page')).toBe(false);
  });

  it('reports a constant only when at least two rows agree', () => {
    expect(constantValue(['a', 'a', 'a'])).toBe('a');
    expect(constantValue(['a', 'b'])).toBeNull();
    expect(constantValue(['a'])).toBeNull();
    expect(constantValue([])).toBeNull();
  });
});

describe('TraceExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAutoRefresh.mockReturnValue({ interval: 0, setRefreshInterval: vi.fn(), setInterval: vi.fn() });

    // useTraces unwraps the { traces } envelope, so it resolves to a bare array.
    mockUseTraces.mockReturnValue({
      data: buildTraces(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      dataUpdatedAt: Date.now(),
    });

    mockUseTrace.mockReturnValue({
      data: {
        traceId: 'fast-0',
        spans: [
          {
            span_id: 'span-1',
            parent_span_id: null,
            name: 'GET /health/0',
            service_name: 'api-gateway',
            start_time: '2026-02-12T10:00:00.000Z',
            duration_ms: 120,
            status: 'ok',
            trace_source: 'ebpf',
            attributes: JSON.stringify({
              endpoint: 'api-gateway',
              'container.name': 'api-container',
              'container.id': 'container-abc',
              'service.namespace': 'production',
              'service.instance.id': 'instance-a',
              'service.version': '1.8.2',
              'deployment.environment': 'prod',
              'url.full': 'http://api-gateway/health',
              'network.transport': 'tcp',
              'process.pid': 4711,
              'process.command_line': '/bin/http-echo --port=8080',
              'telemetry.sdk.name': 'beyla',
            }),
          },
        ],
      },
    });

    mockUseServiceMap.mockReturnValue({ data: { nodes: [], edges: [] } });
    mockUseTraceSummary.mockReturnValue({
      data: {
        totalTraces: 15,
        avgDuration: 85,
        errorRate: 0.2,
        services: 1,
        sourceCounts: { http: 15, ebpf: 0, scheduler: 0, unknown: 0 },
      },
    });
  });

  it('renders the manifest short label as the single page h1', () => {
    renderWithRouter(<TraceExplorerPage />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Traces');
  });

  it('leads with p95/p50 instead of an average the detector does not use', () => {
    renderWithRouter(<TraceExplorerPage />);

    const subtitle = screen.getByTestId('page-header-subtitle');
    expect(subtitle).toHaveTextContent('15 traces');
    expect(subtitle).toHaveTextContent('1 service');
    // 11×10ms, 3×4ms, 1×5000ms → p95 is the 5s outlier, p50 is 10ms.
    expect(subtitle).toHaveTextContent('p95 5.00s');
    expect(subtitle).toHaveTextContent('p50 10ms');
    expect(screen.queryByText(/Avg Duration/)).toBeNull();
  });

  it('drops the three "you can filter" sentences', () => {
    renderWithRouter(<TraceExplorerPage />);

    expect(screen.queryByText(/Tip: select a source below/)).toBeNull();
    expect(screen.queryByText(/Showing all trace sources/)).toBeNull();
    expect(screen.queryByText(/Need precision\?/)).toBeNull();
  });

  it('makes the source chips the filter and drops the parallel dropdown', () => {
    renderWithRouter(<TraceExplorerPage />);

    const sourceFilter = screen.getByTestId('source-filter');
    const ebpfChip = within(sourceFilter).getByRole('button', { name: /eBPF/ });
    expect(ebpfChip).toHaveAttribute('aria-pressed', 'false');
    // The dropdown that used to duplicate this control, with its third vocabulary.
    expect(screen.queryByText('eBPF (Apps)')).toBeNull();
    expect(screen.queryByText('HTTP Requests')).toBeNull();
    expect(screen.queryByText('Background Jobs')).toBeNull();

    fireEvent.click(ebpfChip);

    expect(mockUseTraces.mock.calls.at(-1)?.[0]).toMatchObject({ source: 'ebpf' });
    expect(within(sourceFilter).getByRole('button', { name: /eBPF/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters to the traces the detector threshold would flag', () => {
    renderWithRouter(<TraceExplorerPage />);

    const anomalous = screen.getByRole('button', { name: /Anomalous \(1\)/ });
    expect(anomalous).toHaveAttribute(
      'title',
      expect.stringContaining('TRACES_ANOMALY_P95_ZSCORE'),
    );

    fireEvent.click(anomalous);

    const list = screen.getByTestId('trace-list');
    expect(within(list).getByText('GET /reports/export')).toBeInTheDocument();
    expect(within(list).queryByText('GET /health/0')).toBeNull();
    // The anomaly cut is client-side; the API never sees an unknown status.
    expect(mockUseTraces.mock.calls.at(-1)?.[0]).toMatchObject({ status: undefined });
  });

  it('carries the real total when the visible list is capped', () => {
    // The list is capped at 200 while thousands can match, and this line read
    // "All {visible} traces:". Over a 200-row page that is a claim about the
    // whole result set — an operator reading `container: unknown` here
    // concluded the fleet had no container attribution at all.
    mockUseTraceSummary.mockReturnValue({
      data: {
        totalTraces: 3982,
        avgDuration: 85,
        errorRate: 0.2,
        services: 1,
        sourceCounts: { http: 3982, ebpf: 0, scheduler: 0, unknown: 0 },
      },
    });

    renderWithRouter(<TraceExplorerPage />);

    const constants = screen.getByTestId('constant-fields');
    expect(constants.textContent).toMatch(/These 15 of 3982 traces:/);
    expect(constants.textContent).not.toMatch(/All 15 traces/);
  });

  it('still says "All" when the visible list really is the whole result set', () => {
    // The fixture's 15 rows are all 15 matches, so no qualifier is warranted.
    renderWithRouter(<TraceExplorerPage />);

    expect(screen.getByTestId('constant-fields').textContent).toMatch(/All 15 traces:/);
  });

  it('states fields constant across the result set once, not on every card', () => {
    renderWithRouter(<TraceExplorerPage />);

    const constants = screen.getByTestId('constant-fields');
    expect(constants).toHaveTextContent('api-gateway');
    expect(constants).toHaveTextContent('source: HTTP');

    // Not repeated inside the cards.
    const list = screen.getByTestId('trace-list');
    expect(within(list).queryByText('source: HTTP')).toBeNull();
    expect(within(list).queryByText('api-gateway')).toBeNull();
    // "1 services" was on every row too.
    expect(within(list).queryByText('1 services')).toBeNull();
  });

  it('collapses CORS preflights into one aggregated row', () => {
    renderWithRouter(<TraceExplorerPage />);

    const summary = screen.getByTestId('preflight-summary');
    expect(summary).toHaveTextContent('3 CORS preflight traces (OPTIONS)');
    expect(summary).toHaveTextContent('p95 4ms');

    const list = screen.getByTestId('trace-list');
    expect(within(list).queryByText('OPTIONS *')).toBeNull();

    fireEvent.click(summary);
    expect(within(screen.getByTestId('trace-list')).getAllByText('OPTIONS *')).toHaveLength(3);
  });

  it('keeps the computation guide, behind the header help toggle', () => {
    renderWithRouter(<TraceExplorerPage />);

    expect(screen.queryByText('How these numbers are computed')).toBeNull();

    fireEvent.click(screen.getByTestId('source-guide-toggle'));

    expect(screen.getByText('How these numbers are computed')).toBeInTheDocument();
    expect(screen.getByText(/Beyla captured runtime network spans/)).toBeInTheDocument();
    // The source counters moved here rather than costing a strip above the list.
    expect(screen.getByText(/Ingested in this window/)).toBeInTheDocument();
  });

  it('gives the auto-refresh hook a tick to run', () => {
    renderWithRouter(<TraceExplorerPage />);

    const opts = mockUseAutoRefresh.mock.calls.at(-1) as unknown as [number, { onTick?: () => void }];
    expect(typeof opts[1].onTick).toBe('function');
  });

  it('shows how old the loaded traces are', () => {
    renderWithRouter(<TraceExplorerPage />);
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });

  it('applies advanced filters through trace query state', () => {
    renderWithRouter(<TraceExplorerPage />);

    fireEvent.click(screen.getByText('Show advanced filters'));
    fireEvent.change(screen.getByDisplayValue('Exact match'), { target: { value: 'contains' } });
    fireEvent.change(screen.getByLabelText('HTTP Route'), { target: { value: '/health' } });
    fireEvent.change(screen.getByLabelText('HTTP Status Code'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Container Name'), { target: { value: 'api-container' } });

    // The 26 OTEL attribute fields are one further click away.
    expect(screen.queryByLabelText('Telemetry SDK Version')).toBeNull();
    fireEvent.click(screen.getByTestId('toggle-attribute-filters'));
    fireEvent.change(screen.getByLabelText('Service Instance ID'), { target: { value: 'instance-a' } });
    fireEvent.change(screen.getByLabelText('Server Port'), { target: { value: '8443' } });
    fireEvent.change(screen.getByLabelText('Telemetry SDK Name'), { target: { value: 'beyla' } });

    const lastCall = mockUseTraces.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastCall.httpRoute).toBe('/health');
    expect(lastCall.httpRouteMatch).toBe('contains');
    expect(lastCall.httpStatusCode).toBe(200);
    expect(lastCall.containerName).toBe('api-container');
    expect(lastCall.serviceInstanceId).toBe('instance-a');
    expect(lastCall.serverPort).toBe(8443);
    expect(lastCall.telemetrySdkName).toBe('beyla');
  });

  it('keeps span metadata in the detail pane', () => {
    renderWithRouter(<TraceExplorerPage />);

    fireEvent.click(within(screen.getByTestId('trace-list')).getByText('GET /health/0'));

    expect(screen.getByText('Service Namespace')).toBeInTheDocument();
    expect(screen.getAllByText('production').length).toBeGreaterThan(0);
    expect(screen.getByText('Service Instance')).toBeInTheDocument();
    expect(screen.getAllByText('instance-a').length).toBeGreaterThan(0);
    expect(screen.getByText('Process PID')).toBeInTheDocument();
    expect(screen.getAllByText('4711').length).toBeGreaterThan(0);
  });

  it('links a span to its logs with theme tokens, not a dark-only blue', () => {
    renderWithRouter(<TraceExplorerPage />);

    fireEvent.click(within(screen.getByTestId('trace-list')).getByText('GET /health/0'));

    const link = screen.getByTestId('view-logs-link');
    expect(link.className).toContain('text-primary');
    expect(link.className).not.toContain('text-blue-200');
  });

  it('pre-applies service / status / trace from URL query params', () => {
    renderWithRouter(
      <TraceExplorerPage />,
      '/traces?service=payments-api&status=error&trace=fast-0',
    );

    const opts = mockUseTraces.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(opts.serviceName).toBe('payments-api');
    expect(opts.status).toBe('error');
    expect(mockUseTrace.mock.calls.at(-1)?.[0]).toBe('fast-0');
  });
});
