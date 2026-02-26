import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { isValidElement } from 'react';
import { MetricsLineChart } from './metrics-line-chart';
import type { AnomalyExplanation } from '@/features/observability/hooks/use-metrics';

// Mock Recharts — renders children and data attributes for testing
vi.mock('recharts', () => {
  const ResponsiveContainer = ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  );
  const AreaChart = ({ children, data }: any) => (
    <svg data-testid="area-chart" data-length={data?.length}>
      {children}
    </svg>
  );
  const Area = () => <g data-testid="area" />;
  const XAxis = () => <g data-testid="x-axis" />;
  const YAxis = () => <g data-testid="y-axis" />;
  const Tooltip = () => <g data-testid="tooltip" />;
  const Legend = () => <g data-testid="legend" />;
  const Line = () => <g data-testid="line" />;
  const ReferenceDot = ({ shape }: any) => {
    if (shape && isValidElement(shape)) {
      return <g data-testid="reference-dot">{shape}</g>;
    }
    return <g data-testid="reference-dot" />;
  };
  return { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, Line, ReferenceDot };
});

const baseData = [
  { timestamp: '2025-01-01T00:00:00Z', value: 30 },
  { timestamp: '2025-01-01T00:01:00Z', value: 45 },
  { timestamp: '2025-01-01T00:02:00Z', value: 92, isAnomaly: true },
  { timestamp: '2025-01-01T00:03:00Z', value: 40 },
];

const mockExplanations: AnomalyExplanation[] = [
  {
    id: 'exp-1',
    severity: 'critical',
    category: 'anomaly',
    title: 'CPU anomaly detected',
    description: 'CPU at 92% (z-score: 3.5)',
    aiExplanation: 'CPU spiked due to a burst of incoming requests.',
    suggestedAction: 'Consider horizontal scaling',
    timestamp: '2025-01-01T00:02:00Z',
  },
];

/** Click the first anomaly dot via its data-testid */
function clickAnomalyDot() {
  const dot = screen.getByTestId('anomaly-dot');
  fireEvent.click(dot);
}

describe('MetricsLineChart', () => {
  it('renders "No metrics data" when data is empty', () => {
    render(<MetricsLineChart data={[]} label="CPU" />);
    expect(screen.getByText('No metrics data')).toBeInTheDocument();
  });

  it('renders the chart when data is provided', () => {
    render(<MetricsLineChart data={baseData} label="CPU Usage" unit="%" />);
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });

  it('renders anomaly reference dots for anomaly points', () => {
    render(<MetricsLineChart data={baseData} label="CPU" />);
    const dots = screen.getAllByTestId('reference-dot');
    expect(dots).toHaveLength(1); // Only 1 anomaly point
  });

  it('shows explanation card when anomaly dot is clicked', () => {
    render(
      <MetricsLineChart
        data={baseData}
        label="CPU"
        unit="%"
        anomalyExplanations={mockExplanations}
      />,
    );

    clickAnomalyDot();

    // Should show the explanation card
    expect(screen.getByText('CPU anomaly detected')).toBeInTheDocument();
    expect(screen.getByText('CPU spiked due to a burst of incoming requests.')).toBeInTheDocument();
    expect(screen.getByText('Consider horizontal scaling')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('shows threshold warning when no explanation matches', () => {
    render(
      <MetricsLineChart
        data={baseData}
        label="CPU"
        unit="%"
        anomalyExplanations={[]} // No explanations
      />,
    );

    clickAnomalyDot();

    expect(screen.getByText(/Value exceeded the 80% warning threshold/)).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
  });

  it('toggles explanation card off when clicking same dot again', () => {
    render(
      <MetricsLineChart
        data={baseData}
        label="CPU"
        unit="%"
        anomalyExplanations={mockExplanations}
      />,
    );

    clickAnomalyDot();
    expect(screen.getByText('CPU anomaly detected')).toBeInTheDocument();

    // Click again to dismiss
    clickAnomalyDot();
    expect(screen.queryByText('CPU anomaly detected')).not.toBeInTheDocument();
  });

  it('dismisses explanation card via close button', () => {
    render(
      <MetricsLineChart
        data={baseData}
        label="CPU"
        unit="%"
        anomalyExplanations={mockExplanations}
      />,
    );

    clickAnomalyDot();
    expect(screen.getByText('CPU anomaly detected')).toBeInTheDocument();

    // Click the X button
    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    expect(screen.queryByText('CPU anomaly detected')).not.toBeInTheDocument();
  });

  it('shows description fallback when AI explanation is null', () => {
    const explanationsNoAi: AnomalyExplanation[] = [
      {
        ...mockExplanations[0],
        aiExplanation: null,
        description: 'CPU at 92% with high z-score',
      },
    ];

    render(
      <MetricsLineChart
        data={baseData}
        label="CPU"
        unit="%"
        anomalyExplanations={explanationsNoAi}
      />,
    );

    clickAnomalyDot();

    expect(screen.getByText('CPU at 92% with high z-score')).toBeInTheDocument();
  });
});
