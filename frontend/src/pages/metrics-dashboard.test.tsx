import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseForecasts = vi.fn();
const mockUseNetworkRates = vi.fn();

// Mock all hooks
vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn().mockReturnValue({ data: [{ id: 1, name: 'local' }], isLoading: false }),
}));

vi.mock('@/hooks/use-containers', () => ({
  useContainers: vi.fn().mockReturnValue({
    data: [
      {
        id: 'c1',
        name: 'api-1',
        image: 'nginx:latest',
        state: 'running',
        status: 'Up',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: { 'com.docker.compose.project': 'alpha' },
        networks: ['frontend'],
      },
      {
        id: 'c2',
        name: 'worker-1',
        image: 'nginx:latest',
        state: 'running',
        status: 'Up',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: { 'com.docker.compose.project': 'alpha' },
        networks: ['frontend', 'jobs'],
      },
      {
        id: 'c4',
        name: 'beta-api-1',
        image: 'nginx:latest',
        state: 'running',
        status: 'Up',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: { 'com.docker.compose.project': 'beta' },
        networks: ['beta-net'],
      },
      {
        id: 'c3',
        name: 'standalone-1',
        image: 'nginx:latest',
        state: 'stopped',
        status: 'Exited',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: {},
        networks: ['standalone-net'],
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock('@/hooks/use-stacks', () => ({
  useStacks: vi.fn().mockReturnValue({
    data: [
      { id: 1, name: 'alpha', endpointId: 1, type: 1, status: 'active', envCount: 0 },
      { id: 2, name: 'beta', endpointId: 1, type: 1, status: 'active', envCount: 0 },
    ],
  }),
}));

vi.mock('@/hooks/use-metrics', () => ({
  useContainerMetrics: vi.fn().mockReturnValue({ data: null, isLoading: false, isError: false }),
  useAnomalies: vi.fn().mockReturnValue({ data: null }),
  useNetworkRates: (...args: unknown[]) => mockUseNetworkRates(...args),
  useAnomalyExplanations: vi.fn().mockReturnValue({ data: null }),
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
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  CartesianGrid: () => null,
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

vi.mock('@/components/metrics/ai-metrics-summary', () => ({
  AiMetricsSummary: () => <div data-testid="ai-metrics-summary" />,
}));

const mockUseLlmModels = vi.fn();
vi.mock('@/hooks/use-llm-models', () => ({
  useLlmModels: (...args: unknown[]) => mockUseLlmModels(...args),
}));

vi.mock('@/components/metrics/inline-chat-panel', () => ({
  InlineChatPanel: ({ open }: { open: boolean }) =>
    open ? <div data-testid="inline-chat-panel">Chat Panel</div> : null,
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
    mockUseNetworkRates.mockReturnValue({
      data: {
        rates: {
          c1: { rxBytesPerSec: 1024, txBytesPerSec: 2048 },
          c2: { rxBytesPerSec: 4096, txBytesPerSec: 512 },
        },
      },
    });

    mockUseLlmModels.mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
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

  it('renders network rx/tx chart for selected container', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const stackSelect = screen.getAllByRole('combobox')[1];
    fireEvent.click(stackSelect);
    fireEvent.click(screen.getByRole('option', { name: 'alpha' }));

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText('Network RX/TX by Network')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByText('2 networks')).toBeInTheDocument();
    expect(screen.getByText('Per-network values are estimated (evenly split)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Full Topology Map' })).toBeInTheDocument();
  });

  it('groups container selector options by stack with a No Stack group', () => {
    renderPage();

    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('No Stack')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'beta-api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'standalone-1' })).toBeInTheDocument();
  });

  it('filters container selector options by selected stack', () => {
    renderPage();

    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const stackSelect = screen.getAllByRole('combobox')[1];
    fireEvent.click(stackSelect);
    fireEvent.click(screen.getByRole('option', { name: 'alpha' }));

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);

    expect(screen.getByRole('option', { name: 'api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'beta-api-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'standalone-1' })).not.toBeInTheDocument();
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

  it('shows Ask AI button when container selected and LLM available', () => {
    renderPage();

    // Select endpoint
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    // Select container
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'api-1' }));

    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('hides Ask AI button when LLM unavailable', () => {
    mockUseLlmModels.mockReturnValue({ data: { models: [], default: '' } });
    renderPage();

    // Select endpoint + container
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'api-1' }));

    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument();
  });

  it('hides Ask AI button when no container selected', () => {
    renderPage();
    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument();
  });

  it('opens inline chat panel when Ask AI is clicked', () => {
    renderPage();

    // Select endpoint + container
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'api-1' }));

    // Click Ask AI
    fireEvent.click(screen.getByText('Ask AI'));
    expect(screen.getByTestId('inline-chat-panel')).toBeInTheDocument();
  });
});
