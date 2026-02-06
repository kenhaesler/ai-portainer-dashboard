import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockAcknowledgeInsight = vi.fn();

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

const mockUseMonitoring = vi.fn();

vi.mock('@/hooks/use-monitoring', () => ({
  useMonitoring: () => mockUseMonitoring(),
}));

vi.mock('@/hooks/use-investigations', () => ({
  safeParseJson: () => [],
  useInvestigations: () => ({
    getInvestigationForInsight: () => undefined,
  }),
}));

vi.mock('@/hooks/use-incidents', () => ({
  useIncidents: () => ({ data: { incidents: [], counts: { active: 0 } } }),
  useResolveIncident: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
}));

import AiMonitorPage from './ai-monitor';

describe('AiMonitorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMonitoring.mockReturnValue({
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
    });
  });

  it('acknowledges an unacknowledged insight from the insight card', () => {
    render(<AiMonitorPage />);

    fireEvent.click(screen.getByText('CPU trend spike'));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(mockAcknowledgeInsight).toHaveBeenCalledWith('insight-1');
  });

  it('filters to only unacknowledged insights', () => {
    render(<AiMonitorPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Unacknowledged' }));

    expect(screen.getByText('CPU trend spike')).toBeInTheDocument();
    expect(screen.queryByText('Memory is stable')).not.toBeInTheDocument();
  });

  it('renders acknowledge error message when mutation fails', () => {
    mockUseMonitoring.mockReturnValue({
      insights: baseInsights,
      isLoading: false,
      error: null,
      subscribedSeverities: new Set(['critical', 'warning', 'info']),
      subscribeSeverity: vi.fn(),
      unsubscribeSeverity: vi.fn(),
      acknowledgeInsight: mockAcknowledgeInsight,
      acknowledgeError: new Error('Failed to acknowledge insight'),
      isAcknowledging: false,
      acknowledgingInsightId: null,
      refetch: vi.fn(),
    });

    render(<AiMonitorPage />);
    fireEvent.click(screen.getByText('CPU trend spike'));

    expect(screen.getByText('Failed to acknowledge insight')).toBeInTheDocument();
  });
});
