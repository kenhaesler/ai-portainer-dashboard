import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseForecasts = vi.fn();

// Mock all hooks
vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn().mockReturnValue({ data: [{ id: 1, name: 'local' }], isLoading: false }),
}));

vi.mock('@/hooks/use-containers', () => ({
  useContainers: vi.fn().mockReturnValue({
    data: [{ id: 'c1', name: 'web-server', endpointId: 1 }],
    isLoading: false,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock('@/hooks/use-metrics', () => ({
  useContainerMetrics: vi.fn().mockReturnValue({ data: null, isLoading: false, isError: false }),
  useAnomalies: vi.fn().mockReturnValue({ data: null }),
}));

vi.mock('@/hooks/use-forecasts', () => ({
  useContainerForecast: vi.fn().mockReturnValue({ data: null }),
  useForecasts: (...args: unknown[]) => mockUseForecasts(...args),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: vi.fn().mockReturnValue({ interval: 0, setInterval: vi.fn() }),
}));

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Legend: () => null,
  ReferenceDot: () => null,
}));

vi.mock('@/components/charts/metrics-line-chart', () => ({
  MetricsLineChart: () => <div data-testid="metrics-chart" />,
}));

vi.mock('@/components/charts/anomaly-sparkline', () => ({
  AnomalySparkline: () => <div data-testid="sparkline" />,
}));

import MetricsDashboardPage from './metrics-dashboard';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MetricsDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MetricsDashboardPage', () => {
  beforeEach(() => {
    mockUseForecasts.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
  });

  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('Metrics Dashboard')).toBeTruthy();
  });

  it('shows select container prompt when no selection', () => {
    renderPage();
    expect(screen.getByText('Select a Container')).toBeTruthy();
  });

  it('renders endpoint selector', () => {
    renderPage();
    const select = screen.getAllByRole('combobox')[0];
    expect(select).toBeTruthy();
  });

  it('renders forecast overview rows and risk badges', () => {
    mockUseForecasts.mockReturnValue({
      data: [
        {
          containerId: 'c-risk',
          containerName: 'api-1',
          metricType: 'cpu',
          currentValue: 92,
          trend: 'increasing',
          slope: 1.1,
          r_squared: 0.9,
          forecast: [],
          timeToThreshold: 1,
          confidence: 'high',
        },
        {
          containerId: 'c-stable',
          containerName: 'worker-2',
          metricType: 'memory',
          currentValue: 48,
          trend: 'stable',
          slope: 0.1,
          r_squared: 0.7,
          forecast: [],
          timeToThreshold: null,
          confidence: 'medium',
        },
      ],
      isLoading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Forecast Overview (Next 24h)')).toBeTruthy();
    expect(screen.getByText('api-1')).toBeTruthy();
    expect(screen.getByText('worker-2')).toBeTruthy();
    expect(screen.getByText('Critical: 1')).toBeTruthy();
    expect(screen.getByText('Healthy: 1')).toBeTruthy();
  });

  it('renders forecast overview error state', () => {
    mockUseForecasts.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('Forecast API unavailable'),
    });

    renderPage();
    expect(screen.getByText('Failed to load forecast overview')).toBeTruthy();
    expect(screen.getByText('Forecast API unavailable')).toBeTruthy();
  });
});
