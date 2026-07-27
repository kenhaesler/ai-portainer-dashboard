import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Stub matchMedia for any motion / media queries
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

// --- mocks ---

vi.mock('@/features/ai-intelligence/components/incident-groups-view', () => ({
  IncidentGroupsView: () => <div data-testid="igv-marker" />,
}));

vi.mock('@/features/ai-intelligence/hooks/use-monitoring', () => ({
  useMonitoring: vi.fn().mockReturnValue({
    insights: [],
    isLoading: false,
    error: null,
    subscribedSeverities: new Set(['critical', 'warning', 'info']),
    subscribeSeverity: vi.fn(),
    unsubscribeSeverity: vi.fn(),
    acknowledgeInsight: vi.fn(),
    acknowledgeError: null,
    isAcknowledging: false,
    acknowledgingInsightId: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-investigations', () => ({
  useInvestigations: vi.fn().mockReturnValue({
    getInvestigationForInsight: vi.fn().mockReturnValue(undefined),
  }),
  safeParseJson: vi.fn().mockReturnValue([]),
}));

vi.mock('@/features/ai-intelligence/hooks/use-incidents', () => ({
  useIncidents: vi.fn().mockReturnValue({ data: null }),
  useResolveIncident: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Captures the `onTick` the page passes. The page used to hand-roll its own
// `window.setInterval` effect; the hook owns the timer now, so the wiring is
// one argument and this is what asserts it is still there.
const capturedAutoRefresh: { onTick?: () => void } = {};
vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: vi.fn((_default?: number, opts?: { onTick?: () => void }) => {
    capturedAutoRefresh.onTick = opts?.onTick;
    return { interval: 0, setRefreshInterval: vi.fn(), setInterval: vi.fn() };
  }),
}));

vi.mock('@/features/observability/hooks/use-correlated-anomalies', () => ({
  useCorrelatedAnomalies: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-anomaly-feedback', async (importOriginal) => {
  // Keep deriveCorrelatedAnomalyId pure so the page-level filter logic
  // can use it; mock the network hooks.
  const actual = await importOriginal<typeof import('@/features/ai-intelligence/hooks/use-anomaly-feedback')>();
  return {
    ...actual,
    useMarkFalsePositive: vi.fn().mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    }),
    useAnomalyFeedbackRates: vi.fn().mockReturnValue({
      data: undefined,
      isLoading: false,
    }),
  };
});

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: vi.fn().mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: vi.fn().mockReturnValue({
    forceRefresh: vi.fn(),
    isForceRefreshing: false,
  }),
}));

import { useMonitoring } from '@/features/ai-intelligence/hooks/use-monitoring';
import { useIncidents } from '@/features/ai-intelligence/hooks/use-incidents';
import { useCorrelatedAnomalies } from '@/features/observability/hooks/use-correlated-anomalies';
import { useContainers } from '@/features/containers/hooks/use-containers';
import AiMonitorPage from './ai-monitor';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AiMonitorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseInsights = [
  {
    id: 'insight-1',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'container-1',
    container_name: 'api-1',
    severity: 'warning' as const,
    category: 'anomaly:cpu',
    title: 'CPU trend spike',
    description: 'CPU utilization increased quickly over 5 minutes.',
    suggested_action: 'Inspect workload pressure.',
    is_acknowledged: 0,
    created_at: '2026-02-06T10:00:00.000Z',
  },
  {
    id: 'insight-2',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'container-2',
    container_name: 'worker-2',
    severity: 'info' as const,
    category: 'anomaly:memory',
    title: 'Memory is stable',
    description: 'No immediate action required.',
    suggested_action: null,
    is_acknowledged: 1,
    created_at: '2026-02-06T10:01:00.000Z',
  },
];

beforeEach(() => {
  vi.mocked(useCorrelatedAnomalies).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useCorrelatedAnomalies>);

  vi.mocked(useIncidents).mockReturnValue({
    data: null,
  } as ReturnType<typeof useIncidents>);

  vi.mocked(useContainers).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  } as unknown as ReturnType<typeof useContainers>);

  vi.mocked(useMonitoring).mockReturnValue({
    insights: [],
    isLoading: false,
    error: null,
    subscribedSeverities: new Set(['critical', 'warning', 'info']),
    subscribeSeverity: vi.fn(),
    unsubscribeSeverity: vi.fn(),
    acknowledgeInsight: vi.fn(),
    acknowledgeError: null,
    isAcknowledging: false,
    acknowledgingInsightId: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMonitoring>);
});

describe('AiMonitorPage', () => {
  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('Health & Monitoring')).toBeTruthy();
  });

  it('shows empty state when no insights exist', () => {
    renderPage();
    expect(screen.getByText('No insights')).toBeTruthy();
  });

  it('renders correlated anomalies section when data exists', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [
        {
          containerId: 'c1',
          containerName: 'web-server',
          metrics: [
            { type: 'cpu', currentValue: 95, mean: 40, zScore: 3.5 },
            { type: 'memory', currentValue: 80, mean: 50, zScore: 2.1 },
          ],
          compositeScore: 4.08,
          pattern: 'cpu z=3.50, memory z=2.10 — both above the z>2 rule threshold',
          patternMatch: {
            id: 'cpu-and-memory-deviation' as const,
            label: 'CPU and memory both deviating',
            zScoreThreshold: 2,
            triggeredBy: [
              { type: 'cpu', zScore: 3.5 },
              { type: 'memory', zScore: 2.1 },
            ],
            withinThreshold: [],
            summary: 'cpu z=3.50, memory z=2.10 — both above the z>2 rule threshold',
          },
          severity: 'high' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();

    // The section is named for what actually runs: a root-mean-square of
    // per-metric z-scores plus a z-score threshold rule. "ML-Detected
    // Anomalies" under a Brain glyph claimed inference that never happened.
    expect(screen.getByText('Correlated metric deviations')).toBeTruthy();
    expect(screen.queryByText('ML-Detected Anomalies')).toBeNull();
    expect(screen.getByText('web-server')).toBeTruthy();
    expect(screen.getByText('CPU and memory both deviating')).toBeTruthy();
    expect(screen.getByText('4.08')).toBeTruthy();
    // Signed z-score values shown.
    expect(screen.getByText('+3.5')).toBeTruthy();
    expect(screen.getByText('+2.1')).toBeTruthy();
    // One severity vocabulary: a composite-score "high" reads as Warning, the
    // same word the filter chips, KPI tiles and insight feed use. The card
    // used to say Critical/High/Medium/Low with no way to rank it against the
    // feed's Critical/Warning/Info.
    const card = within(screen.getByTestId('correlated-anomaly-card'));
    expect(card.getByText('Warning')).toBeTruthy();
    expect(card.queryByText('High')).toBeNull();
  });

  it('hides correlated anomalies section when array is empty', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();
    expect(screen.queryByText('Correlated metric deviations')).toBeNull();
  });

  it('renders IncidentGroupsView section (rollup replaces flat list)', () => {
    renderPage();
    // IncidentGroupsView is mocked — its marker confirms it rendered.
    expect(screen.getByTestId('igv-marker')).toBeTruthy();
  });

  it('shows detection method badge on anomaly insight', () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [
        {
          id: 'ins-1',
          endpoint_id: 1,
          endpoint_name: 'prod',
          container_id: 'c1',
          container_name: 'web',
          severity: 'warning' as const,
          category: 'anomaly',
          title: 'Anomalous cpu usage on "web"',
          description:
            'Current cpu: 92.0% (mean: 40.0%, z-score: 3.20, method: adaptive). This is 3.2 standard deviations from the moving average.',
          suggested_action: 'Check for runaway processes',
          is_acknowledged: 0,
          created_at: '2025-01-15T10:00:00Z',
          // The typed column the backend writes. The badge used to be scraped
          // out of the description with /method:\\s*(\\w+)/, which cannot match
          // a hyphen — so "method: isolation-forest" was badged "Z-Score".
          detection_method: 'ml-anomaly',
        },
      ],
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    const badge = screen.getByTestId('detection-method-badge');
    expect(badge).toHaveAttribute('data-detection-method', 'ml-anomaly');
    expect(badge).toHaveTextContent('Metric anomaly');
    // The description still says "method: adaptive"; the badge no longer
    // invents a technique the persisted column cannot distinguish.
    expect(screen.queryByText('Z-Score')).toBeNull();
  });

  it('hides detection method badge on non-anomaly insight', () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [
        {
          id: 'ins-2',
          endpoint_id: 1,
          endpoint_name: 'prod',
          container_id: 'c1',
          container_name: 'web',
          severity: 'warning' as const,
          category: 'security:privilege',
          title: 'Container running as root',
          description: 'Container is running with elevated privileges.',
          suggested_action: null,
          is_acknowledged: 0,
          created_at: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    // No `detection_method` on the record -> no badge at all, rather than a
    // `?? config.zscore` default asserting a detector that never ran.
    expect(screen.queryByTestId('detection-method-badge')).toBeNull();
    expect(screen.queryByText('Z-Score')).toBeNull();
  });

  it('renders the rule label and the z-scores it fired on, not a diagnosis', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [
        {
          containerId: 'c2',
          containerName: 'api-gateway',
          metrics: [
            { type: 'memory', currentValue: 90, mean: 45, zScore: 2.8 },
          ],
          compositeScore: 2.8,
          pattern: 'memory z=2.80 above the z>2 rule threshold, cpu z=0.40 within it',
          patternMatch: {
            id: 'memory-only-deviation' as const,
            label: 'Memory deviating, CPU within threshold',
            zScoreThreshold: 2,
            triggeredBy: [{ type: 'memory', zScore: 2.8 }],
            withinThreshold: [{ type: 'cpu', zScore: 0.4 }],
            summary: 'memory z=2.80 above the z>2 rule threshold, cpu z=0.40 within it',
          },
          severity: 'medium' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();

    // The badge names what was observed, keyed off the stable rule id.
    const badge = screen.getByTestId('pattern-badge');
    expect(badge.textContent).toBe('Memory deviating, CPU within threshold');
    expect(badge.getAttribute('data-pattern-id')).toBe('memory-only-deviation');

    // The body restates the rule and the numbers it fired on.
    expect(screen.getByTestId('pattern-rule-summary').textContent).toBe(
      'memory z=2.80 above the z>2 rule threshold, cpu z=0.40 within it',
    );

    // The old hardcoded diagnosis must not come back. It rendered
    // byte-identically on every card that hit the same rule branch.
    expect(screen.queryByText(/suggesting gradual memory accumulation/)).toBeNull();
    expect(screen.queryByText('Memory Leak Suspected')).toBeNull();
  });

  it('falls back to the pattern string when patternMatch is absent (stale server build)', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [
        {
          containerId: 'c3',
          containerName: 'legacy-api',
          metrics: [{ type: 'memory', currentValue: 90, mean: 45, zScore: 2.8 }],
          compositeScore: 2.8,
          pattern: 'memory z=2.80 above the z>2 rule threshold',
          patternMatch: null,
          severity: 'medium' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();

    // Body degrades to the legacy string rather than to a blank card...
    expect(screen.getByTestId('pattern-rule-summary').textContent).toBe(
      'memory z=2.80 above the z>2 rule threshold',
    );
    // ...but no badge, since there is no rule id to label it with.
    expect(screen.queryByTestId('pattern-badge')).toBeNull();
  });

  it('acknowledges an unacknowledged insight from the insight card', () => {
    const mockAcknowledgeInsight = vi.fn();
    vi.mocked(useMonitoring).mockReturnValue({
      insights: baseInsights,
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: mockAcknowledgeInsight,
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    fireEvent.click(screen.getByText('CPU trend spike'));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(mockAcknowledgeInsight).toHaveBeenCalledWith('insight-1');
  });

  it('filters to only unacknowledged insights', () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: baseInsights,
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Unacknowledged' }));

    expect(screen.getByText('CPU trend spike')).toBeInTheDocument();
    expect(screen.queryByText('Memory is stable')).not.toBeInTheDocument();
  });

  it('renders fleet health summary with container stats', () => {
    vi.mocked(useContainers).mockReturnValue({
      data: [
        { id: '1', name: 'web', state: 'running', healthStatus: 'healthy', image: 'nginx', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
        { id: '2', name: 'api', state: 'running', healthStatus: 'unhealthy', image: 'node', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
        { id: '3', name: 'db', state: 'running', healthStatus: undefined, image: 'postgres', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
        { id: '4', name: 'cache', state: 'stopped', healthStatus: undefined, image: 'redis', status: 'Exited', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as unknown as ReturnType<typeof useContainers>);

    renderPage();

    // The hero is a count now, not a percentage: 1 unhealthy + 1 stopped
    // container, and no unacknowledged insights in this fixture.
    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('2');
    expect(screen.queryByText('Overall Health Score')).toBeNull();
    // The healthcheck pass rate is still here, named for what it measures and
    // stating its exclusion: healthy / (healthy + unhealthy) = 50%, with the
    // db (no healthcheck) and cache (stopped) outside the denominator.
    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent('50%');
    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent(
      '1 of 2 containers with a healthcheck',
    );
    // /health collapses the container-status strip to a single line — Home
    // already carried the full tile grid.
    expect(screen.getByTestId('fleet-status-line')).toHaveTextContent(
      '4 containers · 3 running · 1 healthy · 1 unhealthy · 1 without a healthcheck',
    );
    expect(screen.queryByText('No Healthcheck')).toBeNull();
  });

  it('shows skeleton loading state for health section', () => {
    vi.mocked(useContainers).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as unknown as ReturnType<typeof useContainers>);

    renderPage();

    // Health section should show skeletons, page title still visible
    expect(screen.getByText('Health & Monitoring')).toBeTruthy();
  });

  it('renders 0% percentages when fleet is empty (no division-by-zero)', () => {
    vi.mocked(useContainers).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as unknown as ReturnType<typeof useContainers>);

    renderPage();

    // Empty fleet: no pass rate can be computed, so we say so rather than
    // rendering an arbitrary 0%.
    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent(
      /Healthcheck pass rate unavailable/,
    );
    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('0');
    // No NaN should ever leak into the rendered DOM.
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });

  it('surfaces unhealthy and stopped containers in the Anomalies & Health Issues section', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useCorrelatedAnomalies>);
    vi.mocked(useContainers).mockReturnValue({
      data: [
        { id: '1', name: 'sick-api', state: 'running', healthStatus: 'unhealthy', image: 'node:20', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
        { id: '2', name: 'crashed-worker', state: 'stopped', healthStatus: undefined, image: 'python:3', status: 'Exited', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
        { id: '3', name: 'healthy-web', state: 'running', healthStatus: 'healthy', image: 'nginx', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as unknown as ReturnType<typeof useContainers>);

    renderPage();

    // The mixed list was split into "ML-Detected Anomalies" + "Container
    // Health". State-based issues (unhealthy/stopped) live under "Container
    // Health" now.
    expect(screen.getByText('Container Health')).toBeTruthy();
    // Both problematic containers appear; healthy one does not
    expect(screen.getByText('sick-api')).toBeTruthy();
    expect(screen.getByText('crashed-worker')).toBeTruthy();
    expect(screen.queryByText('healthy-web')).toBeNull();
    // Correct badges (also appear in stats grid, so use getAllByText)
    expect(screen.getAllByText('Unhealthy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Stopped').length).toBeGreaterThanOrEqual(1);
  });

  it('renders acknowledge error message when mutation fails', () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: baseInsights,
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: new Error('Failed to acknowledge insight'),
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();
    fireEvent.click(screen.getByText('CPU trend spike'));

    expect(screen.getByText('Failed to acknowledge insight')).toBeInTheDocument();
  });
});

// =============================================================================
// New UX features (PR review feedback): cover the AC that previously had no
// behavioural tests — search filtering and bell-icon subscription independence.
// Incident-specific features (time-range, sort, bulk-resolve) now live inside
// IncidentGroupsView which has its own dedicated test suite.
// =============================================================================

import { act } from '@testing-library/react';

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('AiMonitorPage — search', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('search box filters insights and persists to URL after debounce', async () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [
        { id: 'i1', endpoint_id: 1, endpoint_name: 'local', container_id: 'c1', container_name: 'matching-redis', severity: 'warning', category: 'anomaly', title: 'Redis spike', description: '', suggested_action: null, is_acknowledged: 0, created_at: nowIso() },
        { id: 'i2', endpoint_id: 1, endpoint_name: 'local', container_id: 'c2', container_name: 'unrelated-pg', severity: 'warning', category: 'anomaly', title: 'PG normal', description: '', suggested_action: null, is_acknowledged: 0, created_at: nowIso() },
      ],
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    // Both rows visible at first
    expect(screen.getByText('Redis spike')).toBeTruthy();
    expect(screen.getByText('PG normal')).toBeTruthy();

    const searchBox = screen.getByPlaceholderText(/Search by container/i);
    fireEvent.change(searchBox, { target: { value: 'redis' } });

    // Debounce window — advance fake timers past the 150ms threshold
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText('Redis spike')).toBeTruthy();
    expect(screen.queryByText('PG normal')).toBeNull();
  });

  it('clearing the search box restores all rows', async () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [
        { id: 'i1', endpoint_id: 1, endpoint_name: 'local', container_id: 'c1', container_name: 'redis-1', severity: 'warning', category: 'anomaly', title: 'Match A', description: '', suggested_action: null, is_acknowledged: 0, created_at: nowIso() },
        { id: 'i2', endpoint_id: 1, endpoint_name: 'local', container_id: 'c2', container_name: 'pg-1', severity: 'warning', category: 'anomaly', title: 'Match B', description: '', suggested_action: null, is_acknowledged: 0, created_at: nowIso() },
      ],
      isLoading: false, error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(), unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(), acknowledgeError: null,
      isAcknowledging: false, acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();
    const searchBox = screen.getByPlaceholderText(/Search by container/i);
    fireEvent.change(searchBox, { target: { value: 'redis' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('Match B')).toBeNull();

    fireEvent.change(searchBox, { target: { value: '' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('Match A')).toBeTruthy();
    expect(screen.getByText('Match B')).toBeTruthy();
  });
});

describe('AiMonitorPage — container chip linking', () => {
  it('renders a container link to /containers/:endpointId/:containerId on insights with ids', () => {
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [
        {
          id: 'i-link',
          endpoint_id: 7,
          endpoint_name: 'prod',
          container_id: 'c-abc',
          container_name: 'linkable-container',
          severity: 'warning',
          category: 'anomaly',
          title: 'Linkable',
          description: '',
          suggested_action: null,
          is_acknowledged: 0,
          created_at: nowIso(),
        },
      ],
      isLoading: false, error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(), unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(), acknowledgeError: null,
      isAcknowledging: false, acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    // The accessible name for a link comes from its text content. The chip
    // wraps a Box icon + the container name. The chip lives inside a
    // `hidden sm:flex` wrapper which jsdom treats as inaccessible by default,
    // so opt into hidden lookups for the query.
    const link = screen.getByRole('link', { name: /linkable-container/i, hidden: true });
    expect(link.getAttribute('href')).toBe('/containers/7/c-abc');
  });
});

// Stat-card subscription/filter independence test removed — the per-severity
// stat cards (with their bell-icon subscription toggles) were folded into the
// Fleet Vitals hero as display-only HealthStatTiles. Filter is now driven by
// the severity-tab strip and subscriptions are managed via useMonitoring's
// defaults; no per-card affordance remains for this test to exercise.

describe('AiMonitorPage — IncidentGroupsView integration', () => {
  it('renders IncidentGroupsView in place of the legacy flat list', () => {
    renderPage();
    expect(screen.getByTestId('igv-marker')).toBeTruthy();
  });
});

// ── False-positive feedback + per-detector rate badge (#1298) ───────

describe('AiMonitorPage — false-positive feedback (#1298)', () => {
  it('renders a "Mark as false positive" button on each CorrelatedAnomalyCard', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [
        {
          containerId: 'c1',
          containerName: 'web-server',
          metrics: [{ type: 'cpu', currentValue: 95, mean: 40, zScore: 3.5 }],
          compositeScore: 3.5,
          pattern: null,
          severity: 'high' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();
    expect(screen.getByTestId('mark-false-positive')).toBeTruthy();
  });

  it('invokes the mutation with the derived correlated anomaly id and detector tag', async () => {
    const mutate = vi.fn();
    const { useMarkFalsePositive } = await import('@/features/ai-intelligence/hooks/use-anomaly-feedback');
    vi.mocked(useMarkFalsePositive).mockReturnValue({
      mutate,
      isPending: false,
      variables: undefined,
    } as unknown as ReturnType<typeof useMarkFalsePositive>);

    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [
        {
          containerId: 'c-abc',
          containerName: 'web-server',
          metrics: [{ type: 'cpu', currentValue: 95, mean: 40, zScore: 3.5 }],
          compositeScore: 3.5,
          pattern: null,
          severity: 'high' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();

    const btn = screen.getByTestId('mark-false-positive');
    fireEvent.click(btn);

    expect(mutate).toHaveBeenCalledWith({
      anomalyId: 'correlated:c-abc:2025-01-15T10:00:00Z',
      detector: 'correlated-zscore',
    });
  });

  it('renders a per-detector rate badge when feedback rates are available', async () => {
    const { useAnomalyFeedbackRates } = await import('@/features/ai-intelligence/hooks/use-anomaly-feedback');
    vi.mocked(useAnomalyFeedbackRates).mockReturnValue({
      data: {
        rates: [
          { detector: 'threshold', anomalies: 10, falsePositives: 2, rate: 0.2 },
          { detector: 'ml-anomaly', anomalies: 0, falsePositives: 0, rate: 0 },
        ],
        scope: 'mine',
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAnomalyFeedbackRates>);

    renderPage();

    expect(screen.getByTestId('anomaly-feedback-rate-row')).toBeTruthy();
    expect(screen.getByTestId('anomaly-feedback-rate-threshold')).toBeTruthy();
    // 20% rendered for threshold
    expect(screen.getByTestId('anomaly-feedback-rate-threshold').textContent).toContain('20%');
    // Empty-state "—" rendered for ml-anomaly (zero anomalies recorded)
    expect(screen.getByTestId('anomaly-feedback-rate-ml-anomaly').textContent).toContain('—');
  });

  it('hides the rate badge row when no detectors have data yet', async () => {
    const { useAnomalyFeedbackRates } = await import('@/features/ai-intelligence/hooks/use-anomaly-feedback');
    vi.mocked(useAnomalyFeedbackRates).mockReturnValue({
      data: { rates: [], scope: 'mine' },
      isLoading: false,
    } as unknown as ReturnType<typeof useAnomalyFeedbackRates>);

    renderPage();
    expect(screen.queryByTestId('anomaly-feedback-rate-row')).toBeNull();
  });

  it('wires the auto-refresh dropdown through the hook onTick, not a hand-rolled timer', () => {
    const refetch = vi.fn();
    const containerRefetch = vi.fn();
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [],
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch,
    } as unknown as ReturnType<typeof useMonitoring>);
    vi.mocked(useContainers).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: containerRefetch,
      isFetching: false,
    } as unknown as ReturnType<typeof useContainers>);

    renderPage();

    expect(capturedAutoRefresh.onTick).toBeTypeOf('function');
    capturedAutoRefresh.onTick?.();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(containerRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders the page title through the shared PageHeader with live-state subtitle', () => {
    renderPage();

    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Health & Monitoring',
    );
    // The old subtitle promised "real-time AI-powered insights".
    expect(screen.queryByText(/AI-powered/i)).toBeNull();
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(/insight/);
  });

  it('collapses re-emissions of the same fact into one row with a disclosure', async () => {
    // A missing HEALTHCHECK is a configuration state, not an event; 12 of 20
    // Info insights on a real fleet were two facts restated hourly, each with
    // the same 40-word remediation paragraph.
    const repeated = [3, 2, 1].map((hour) => ({
      id: `hc-${hour}`,
      endpoint_id: 1,
      endpoint_name: 'local',
      container_id: 'c-lcm-web',
      container_name: 'lcm-web',
      severity: 'info' as const,
      category: 'health-check',
      title: 'Container "lcm-web" has no health check configured',
      description: 'Add a HEALTHCHECK instruction to the image.',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: `2026-07-26T0${hour}:00:00Z`,
    }));
    vi.mocked(useMonitoring).mockReturnValue({
      insights: repeated,
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    // One group, one visible card, and the other two behind a disclosure that
    // prints its own count so the "Info" tile still reconciles.
    expect(screen.getAllByTestId('insight-group')).toHaveLength(1);
    const toggle = screen.getByTestId('insight-group-toggle');
    expect(toggle).toHaveTextContent('Show 2 earlier occurrences');
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);

    fireEvent.click(toggle);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('does not group insights that differ by container or title', () => {
    const distinct = [
      {
        id: 'a', endpoint_id: 1, endpoint_name: 'local', container_id: 'c1',
        container_name: 'lcm-web', severity: 'info' as const, category: 'health-check',
        title: 'Container "lcm-web" has no health check configured',
        description: '', suggested_action: null, is_acknowledged: 0,
        created_at: '2026-07-26T03:00:00Z',
      },
      {
        id: 'b', endpoint_id: 1, endpoint_name: 'local', container_id: 'c2',
        container_name: 'docker-portainer-1', severity: 'info' as const, category: 'health-check',
        title: 'Container "docker-portainer-1" has no health check configured',
        description: '', suggested_action: null, is_acknowledged: 0,
        created_at: '2026-07-26T03:00:00Z',
      },
    ];
    vi.mocked(useMonitoring).mockReturnValue({
      insights: distinct,
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    expect(screen.getAllByTestId('insight-group')).toHaveLength(2);
    expect(screen.queryByTestId('insight-group-toggle')).toBeNull();
  });
});
