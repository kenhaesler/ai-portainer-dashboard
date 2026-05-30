import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockUseContainerMetrics = vi.fn();
const mockUseNetworkRates = vi.fn();

vi.mock('@/features/observability/hooks/use-metrics', () => ({
  useContainerMetrics: (...args: unknown[]) => mockUseContainerMetrics(...args),
  useNetworkRates: (...args: unknown[]) => mockUseNetworkRates(...args),
}));

vi.mock('@/shared/components/charts/metrics-line-chart', () => ({
  MetricsLineChart: ({ label }: { label: string }) => <div data-testid={`metrics-chart-${label.toLowerCase()}`} />,
}));

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Legend: () => null,
}));

import { ContainerMetricsViewer } from './container-metrics-viewer';

describe('ContainerMetricsViewer', () => {
  beforeEach(() => {
    mockUseContainerMetrics.mockImplementation((endpointId: number, containerId: string, metricType: string) => ({
      data: {
        containerId,
        endpointId,
        metricType,
        timeRange: '1h',
        data: [{ timestamp: '2026-02-08T00:00:00.000Z', value: metricType === 'cpu' ? 20 : 35 }],
      },
      isLoading: false,
    }));

    mockUseNetworkRates.mockReturnValue({
      data: {
        rates: {
          c1: { rxBytesPerSec: 2 * 1024 * 1024, txBytesPerSec: 1024 * 1024 },
        },
      },
      isLoading: false,
    });
  });

  it('renders RX/TX chart for container networks', () => {
    render(
      <ContainerMetricsViewer
        endpointId={1}
        containerId="c1"
        containerNetworks={['frontend', 'backend']}
        showTimeRangeSelector={false}
      />
    );

    expect(screen.getByText('Network RX/TX by Network')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByText('2 networks')).toBeInTheDocument();
    expect(screen.getByText('Per-network values are estimated (evenly split)')).toBeInTheDocument();
  });

  it('shows empty network state when container has no networks', () => {
    render(
      <ContainerMetricsViewer
        endpointId={1}
        containerId="c1"
        containerNetworks={[]}
        showTimeRangeSelector={false}
      />
    );

    expect(screen.getByText('No connected networks found for this container')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('uses a provided time range when controlled by parent', () => {
    render(
      <ContainerMetricsViewer
        endpointId={1}
        containerId="c1"
        containerNetworks={['frontend']}
        showTimeRangeSelector={false}
        timeRange="6h"
      />
    );

    expect(mockUseContainerMetrics).toHaveBeenCalledWith(1, 'c1', 'cpu', '6h');
    expect(mockUseContainerMetrics).toHaveBeenCalledWith(1, 'c1', 'memory', '6h');
  });
});
