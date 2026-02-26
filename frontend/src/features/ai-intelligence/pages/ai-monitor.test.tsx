import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
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

vi.mock('@/hooks/use-monitoring', () => ({
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

vi.mock('@/hooks/use-investigations', () => ({
  useInvestigations: vi.fn().mockReturnValue({
    getInvestigationForInsight: vi.fn().mockReturnValue(undefined),
  }),
  safeParseJson: vi.fn().mockReturnValue([]),
}));

vi.mock('@/hooks/use-incidents', () => ({
  useIncidents: vi.fn().mockReturnValue({ data: null }),
  useResolveIncident: vi.fn().mockReturnValue({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: vi.fn().mockReturnValue({ interval: 0, setInterval: vi.fn() }),
}));

vi.mock('@/hooks/use-correlated-anomalies', () => ({
  useCorrelatedAnomalies: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
  }),
}));

import { useMonitoring } from '@/hooks/use-monitoring';
import { useIncidents } from '@/hooks/use-incidents';
import { useCorrelatedAnomalies } from '@/hooks/use-correlated-anomalies';
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
    expect(screen.getByText('AI Monitor')).toBeTruthy();
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

    expect(screen.getByText('Correlated Anomalies')).toBeTruthy();
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
    expect(screen.queryByText('Correlated Anomalies')).toBeNull();
  });

  it('renders IncidentCard with colored correlation type badge', () => {
    vi.mocked(useIncidents).mockReturnValue({
      data: {
        incidents: [
          {
            id: 'inc-1',
            title: 'Multiple containers CPU spike',
            severity: 'critical' as const,
            status: 'active' as const,
            root_cause_insight_id: null,
            related_insight_ids: '[]',
            affected_containers: '["nginx","redis"]',
            endpoint_id: 1,
            endpoint_name: 'prod',
            correlation_type: 'temporal',
            correlation_confidence: 'high' as const,
            insight_count: 3,
            summary: 'Correlated CPU anomalies',
            created_at: '2025-01-15T10:00:00Z',
            updated_at: '2025-01-15T10:00:00Z',
            resolved_at: null,
          },
        ],
        counts: { active: 1, resolved: 0, total: 1 },
        limit: 50,
        offset: 0,
      },
    } as ReturnType<typeof useIncidents>);

    renderPage();

    // Should show "Temporal" badge text, not "temporal correlation" plain text
    expect(screen.getByText('Temporal')).toBeTruthy();
    expect(screen.queryByText('temporal correlation')).toBeNull();
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
