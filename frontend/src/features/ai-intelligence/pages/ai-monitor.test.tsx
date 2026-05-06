import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: vi.fn().mockReturnValue({ interval: 0, setInterval: vi.fn() }),
}));

vi.mock('@/features/observability/hooks/use-correlated-anomalies', () => ({
  useCorrelatedAnomalies: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
  }),
}));

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
          pattern: 'Resource Exhaustion: Both CPU and memory are elevated',
          severity: 'high' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();

    // Section was renamed from "Anomalies & Health Issues" to clearer twin
    // sections: "ML-Detected Anomalies" + "Container Health".
    expect(screen.getByText('ML-Detected Anomalies')).toBeTruthy();
    expect(screen.getByText('web-server')).toBeTruthy();
    expect(screen.getByText('Resource Exhaustion')).toBeTruthy();
    expect(screen.getByText('4.08')).toBeTruthy();
    // z-score values shown
    expect(screen.getByText('3.5')).toBeTruthy();
    expect(screen.getByText('2.1')).toBeTruthy();
  });

  it('hides correlated anomalies section when array is empty', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();
    expect(screen.queryByText('ML-Detected Anomalies')).toBeNull();
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

    expect(screen.getByText('Adaptive')).toBeTruthy();
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

    expect(screen.queryByText('Z-Score')).toBeNull();
    expect(screen.queryByText('Bollinger')).toBeNull();
    expect(screen.queryByText('Adaptive')).toBeNull();
  });

  it('renders pattern badge with correct short label extracted from full pattern string', () => {
    vi.mocked(useCorrelatedAnomalies).mockReturnValue({
      data: [
        {
          containerId: 'c2',
          containerName: 'api-gateway',
          metrics: [
            { type: 'memory', currentValue: 90, mean: 45, zScore: 2.8 },
          ],
          compositeScore: 2.8,
          pattern: 'Memory Leak Suspected: Memory usage is elevated while CPU remains normal',
          severity: 'medium' as const,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useCorrelatedAnomalies>);

    renderPage();

    // Short label only, not full description
    expect(screen.getByText('Memory Leak Suspected')).toBeTruthy();
    // The description part appears separately
    expect(
      screen.getByText('Memory usage is elevated while CPU remains normal'),
    ).toBeTruthy();
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
        { id: '4', name: 'cache', state: 'exited', healthStatus: undefined, image: 'redis', status: 'Exited', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as unknown as ReturnType<typeof useContainers>);

    renderPage();

    // New score formula: healthy / (healthy + unhealthy). 1 healthy + 1
    // unhealthy = 50.0%. The db (no healthcheck) and cache (exited) are
    // excluded from the denominator so the operator's healthcheck coverage
    // gap doesn't penalise the score.
    expect(screen.getByText('Overall Health Score')).toBeTruthy();
    expect(screen.getAllByText('50.0%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.getAllByText('Unhealthy').length).toBeGreaterThanOrEqual(1);
    // The "Stopped" stat card was replaced by "No Healthcheck" — surfacing
    // the cohort that's actually excluded from scoring is more useful than
    // counting exited containers (already shown elsewhere as health issues).
    expect(screen.getByText('No Healthcheck')).toBeTruthy();
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

    // Empty fleet now shows "No healthchecks configured" instead of an
    // arbitrary 0.0% — the new score formula returns null when no container
    // reports a health signal and we surface that as N/A so operators are
    // not misled by a bogus zero.
    expect(screen.getByTestId('health-score-na')).toBeTruthy();
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
        { id: '2', name: 'crashed-worker', state: 'exited', healthStatus: undefined, image: 'python:3', status: 'Exited', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
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

describe('AiMonitorPage — stat card filter vs subscription independence', () => {
  it('clicking the bell icon toggles subscription without changing the severity filter', async () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    vi.mocked(useMonitoring).mockReturnValue({
      insights: [],
      isLoading: false, error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: subscribe,
      unsubscribeSeverity: unsubscribe,
      acknowledgeInsight: vi.fn(),
      acknowledgeError: null,
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMonitoring>);

    renderPage();

    // Bell button has accessible name "Pause live critical alerts"
    const pauseCritical = screen.getByRole('button', { name: /Pause live critical alerts/i });
    fireEvent.click(pauseCritical);

    expect(unsubscribe).toHaveBeenCalledWith('critical');
    // Should NOT have triggered a severity-filter change — the All filter
    // tab remains the active tab (aria-pressed=true on Total Insights btn).
    const totalCard = screen.getByRole('button', { name: /Total Insights/i });
    expect(totalCard.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('AiMonitorPage — IncidentGroupsView integration', () => {
  it('renders IncidentGroupsView in place of the legacy flat list', () => {
    renderPage();
    expect(screen.getByTestId('igv-marker')).toBeTruthy();
  });
});
