import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockUseForecasts = vi.fn();
const mockUseNetworkRates = vi.fn();
const mockUseContainerMetricsMeta = vi.fn();

// Mock all hooks
vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn().mockReturnValue({
    data: [{ id: 1, name: 'local', totalCpu: 4, totalMemory: 34359738368 }], // 32 GiB
    isLoading: false,
  }),
}));

vi.mock('@/features/containers/hooks/use-containers', () => ({
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

vi.mock('@/features/containers/hooks/use-stacks', () => ({
  useStacks: vi.fn().mockReturnValue({
    data: [
      { id: 1, name: 'alpha', endpointId: 1, type: 1, status: 'active', envCount: 0 },
      { id: 2, name: 'beta', endpointId: 1, type: 1, status: 'active', envCount: 0 },
    ],
  }),
}));

vi.mock('@/features/observability/hooks/use-metrics', () => ({
  useContainerMetrics: vi.fn().mockReturnValue({ data: null, isLoading: false, isError: false }),
  useContainerMetricsMeta: (...args: unknown[]) => mockUseContainerMetricsMeta(...args),
  useAnomalies: vi.fn().mockReturnValue({ data: null }),
  useNetworkRates: (...args: unknown[]) => mockUseNetworkRates(...args),
  useAnomalyExplanations: vi.fn().mockReturnValue({ data: null }),
}));

const mockUseAiForecastNarrative = vi.fn();
const mockUseContainerForecast = vi.fn();
vi.mock('@/features/observability/hooks/use-forecasts', () => ({
  useContainerForecast: (...args: unknown[]) => mockUseContainerForecast(...args),
  useForecasts: (...args: unknown[]) => mockUseForecasts(...args),
  useAiForecastNarrative: (...args: unknown[]) => mockUseAiForecastNarrative(...args),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
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

vi.mock('@/shared/components/charts/metrics-line-chart', () => ({
  MetricsLineChart: () => <div data-testid="metrics-chart" />,
}));

vi.mock('@/shared/components/charts/anomaly-sparkline', () => ({
  AnomalySparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('@/features/ai-intelligence/components/metrics/ai-metrics-summary', () => ({
  AiMetricsSummary: () => <div data-testid="ai-metrics-summary" />,
}));

const mockUseLlmModels = vi.fn();
vi.mock('@/features/ai-intelligence/hooks/use-llm-models', () => ({
  useLlmModels: (...args: unknown[]) => mockUseLlmModels(...args),
}));

vi.mock('@/features/ai-intelligence/components/metrics/inline-chat-panel', () => ({
  InlineChatPanel: ({ open }: { open: boolean }) =>
    open ? <div data-testid="inline-chat-panel">Chat Panel</div> : null,
}));

vi.mock('@/features/ai-intelligence/components/metrics/correlation-insights-panel', () => ({
  CorrelationInsightsPanel: () => <div data-testid="correlation-insights-panel" />,
}));

// Stub RefreshControls: its real implementation renders a native <select>
// which would appear before the page's own endpoint/stack/container selects in
// the combobox role-list and shift these tests' index-based selectors.
vi.mock('@/shared/components/ui/refresh-controls', () => ({
  RefreshControls: () => <div data-testid="mock-auto-refresh" />,
}));

// Stub FleetSearch to call onSearch synchronously (no 300ms debounce) so tests
// can assert filtered dropdown options without fake-timer juggling.
vi.mock('@/features/containers/components/fleet/fleet-search', () => ({
  FleetSearch: ({ label, onSearch, placeholder }: { label: string; onSearch: (q: string) => void; placeholder?: string }) => (
    <input
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => onSearch(e.target.value)}
    />
  ),
}));

import MetricsDashboardPage from './metrics-dashboard';
import { useHeaderContextStore } from '@/stores/header-context-store';
import { useContainerMetrics } from '@/features/observability/hooks/use-metrics';

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
    useHeaderContextStore.setState({ metricsContainerName: null });
    vi.mocked(useContainerMetrics).mockReturnValue({ data: null, isLoading: false, isError: false } as never);
    mockUseContainerMetricsMeta.mockReturnValue({
      data: { memoryLimitBytes: 536870912, onlineCpus: 4, usedBytes: 337641472 },
    });
    mockUseForecasts.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    mockUseContainerForecast.mockReturnValue({ data: null });
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
    mockUseAiForecastNarrative.mockReturnValue({
      data: null,
      isLoading: false,
    });
  });

  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('Metrics Dashboard')).toBeTruthy();
  });

  it('shows select container prompt when no selection', () => {
    renderPage();
    expect(screen.getByText('Select a container')).toBeTruthy();
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

  it('renders the forecast overview as a DataTable with column headers and rows', () => {
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

    // The shared DataTable renders with its data-table testid (no per-table search).
    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    expect(screen.queryByTestId('data-table-search')).not.toBeInTheDocument();

    // Column headers are preserved.
    expect(screen.getByRole('columnheader', { name: /Rank/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Container/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Metric/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Current/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Trend/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Threshold ETA/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Status/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Action/ })).toBeInTheDocument();

    // Cell rendering / formatting is preserved.
    expect(screen.getByText('92.0%')).toBeInTheDocument();
    expect(screen.getByText('~1h')).toBeInTheDocument();
    expect(screen.getByText('No breach predicted')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('healthy')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View Details' })).toHaveLength(2);
  });

  it('drills into a container when View Details is clicked in the DataTable', () => {
    mockUseForecasts.mockReturnValue({
      data: [
        {
          containerId: 'c1',
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
      ],
      isLoading: false,
      error: null,
    });

    renderPage();

    // Drilling selects the container (c1 → endpoint local), surfacing the network panel.
    fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
    expect(screen.getByText('Network RX/TX by Network')).toBeInTheDocument();
  });

  it('shows skeleton loading rows (not a DataTable) while the forecast overview loads', () => {
    mockUseForecasts.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });

    renderPage();
    // Loading state is the hand-rolled skeleton, not the DataTable.
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
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

  describe('AI Forecast Narrative', () => {
    const mockForecast = {
      containerId: 'c1',
      containerName: 'api-1',
      metricType: 'cpu',
      currentValue: 75,
      trend: 'increasing' as const,
      slope: 2.5,
      r_squared: 0.85,
      forecast: [],
      timeToThreshold: 6,
      confidence: 'high' as const,
    };

    function selectContainer() {
      const endpointSelect = screen.getAllByRole('combobox')[0];
      fireEvent.click(endpointSelect);
      fireEvent.click(screen.getByRole('option', { name: 'local' }));
      const containerSelect = screen.getAllByRole('combobox')[2];
      fireEvent.click(containerSelect);
      fireEvent.click(screen.getByRole('option', { name: 'api-1' }));
    }

    it('renders AI narrative text in forecast card', () => {
      mockUseContainerForecast.mockReturnValue({ data: mockForecast });
      mockUseAiForecastNarrative.mockReturnValue({
        data: { narrative: 'CPU is rising steadily. Consider scaling before it hits 90%.' },
        isLoading: false,
      });

      renderPage();
      selectContainer();

      // Both CPU and memory cards render with AI Analysis
      const labels = screen.getAllByText('AI Analysis');
      expect(labels.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('CPU is rising steadily. Consider scaling before it hits 90%.').length).toBeGreaterThanOrEqual(1);
    });

    it('shows skeleton while narrative is loading', () => {
      mockUseContainerForecast.mockReturnValue({ data: mockForecast });
      mockUseAiForecastNarrative.mockReturnValue({
        data: null,
        isLoading: true,
      });

      renderPage();
      selectContainer();

      const labels = screen.getAllByText('AI Analysis');
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });

    it('hides narrative section when LLM is unavailable', () => {
      mockUseLlmModels.mockReturnValue({ data: { models: [], default: '' } });
      mockUseContainerForecast.mockReturnValue({ data: mockForecast });

      renderPage();
      selectContainer();

      expect(screen.queryByText('AI Analysis')).not.toBeInTheDocument();
    });

    it('shows fallback when narrative is null', () => {
      mockUseContainerForecast.mockReturnValue({ data: mockForecast });
      mockUseAiForecastNarrative.mockReturnValue({
        data: { narrative: null },
        isLoading: false,
      });

      renderPage();
      selectContainer();

      const fallbacks = screen.getAllByText('Narrative unavailable');
      expect(fallbacks.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('removes the Container KPI card and keeps three metric cards', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    const kpiGrid = screen.getByTestId('metrics-kpi-grid');
    expect(within(kpiGrid).queryByText('Container')).toBeNull();
    expect(kpiGrid.children).toHaveLength(3);
    expect(screen.getByText('Avg CPU')).toBeInTheDocument();
    expect(screen.getByText('Avg Memory')).toBeInTheDocument();
    expect(screen.getByText('Peak Memory')).toBeInTheDocument();
    expect(kpiGrid.className).toContain('md:grid-cols-3');
  });

  it('shows the CPU core-count clarification sub-label', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/of 4 cores/)).toBeInTheDocument();
    expect(screen.getByText(/max 400%/)).toBeInTheDocument();
  });

  it('shows the memory denominator with the container limit', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/512 MB limit/)).toBeInTheDocument();
  });

  it('uses the range-average used bytes for the memory numerator when the series has data', () => {
    // memory_bytes series averages 256 MB; the live /meta sample (322 MB from the
    // default mock) must NOT be used, so the numerator matches the avg-% headline.
    vi.mocked(useContainerMetrics).mockImplementation(
      (_endpointId, _containerId, metricType) =>
        (metricType === 'memory_bytes'
          ? { data: { data: [{ timestamp: '2024-01-01T00:00:00Z', value: 268435456 }] }, isLoading: false, isError: false }
          : { data: null, isLoading: false, isError: false }) as never,
    );

    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/256 MB \/ 512 MB limit/)).toBeInTheDocument();
    expect(screen.queryByText(/322 MB/)).toBeNull();
  });

  it('labels memory as host-total when no limit is set', () => {
    mockUseContainerMetricsMeta.mockReturnValue({
      data: { memoryLimitBytes: 34359738368, onlineCpus: 4, usedBytes: 2791728742 }, // limit == host RAM
    });
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/no limit set/)).toBeInTheDocument();
  });

  it('hides the memory denominator when meta is unavailable but still shows CPU cores from the endpoint', () => {
    mockUseContainerMetricsMeta.mockReturnValue({ data: null });
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    // CPU label falls back to endpoint.totalCpu (4 cores)
    expect(screen.getByText(/of 4 cores/)).toBeInTheDocument();
    // Memory denominator requires meta → absent
    expect(screen.queryByText(/limit/)).toBeNull();
    expect(screen.queryByText(/no limit set/)).toBeNull();
  });

  it('filters the container dropdown options via the search box', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const search = screen.getByLabelText('Search containers');
    fireEvent.change(search, { target: { value: 'worker' } });

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'api-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'beta-api-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'standalone-1' })).not.toBeInTheDocument();
  });

  it('filters the container dropdown by stack name, not just container name', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    // "alpha" is a STACK name; neither api-1 nor worker-1 has it in their container name.
    const search = screen.getByLabelText('Search containers');
    fireEvent.change(search, { target: { value: 'alpha' } });

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    expect(screen.getByRole('option', { name: 'api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'beta-api-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'standalone-1' })).not.toBeInTheDocument();
  });

  it('renders the three metric charts in a 2-up grid', () => {
    vi.mocked(useContainerMetrics).mockReturnValue({
      data: { data: [{ timestamp: '2024-01-01T00:00:00Z', value: 50 }] },
      isLoading: false,
      isError: false,
    } as never);

    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    const grid = screen.getByTestId('metrics-charts-grid');
    expect(grid.className).toContain('lg:grid-cols-2');
    expect(within(grid).getAllByTestId('metrics-chart')).toHaveLength(3);
  });

  it('publishes the selected container name to the header store and clears on unmount', async () => {
    const { unmount } = renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    await waitFor(() =>
      expect(useHeaderContextStore.getState().metricsContainerName).toBe('worker-1'),
    );

    unmount();
    expect(useHeaderContextStore.getState().metricsContainerName).toBeNull();
  });
});
