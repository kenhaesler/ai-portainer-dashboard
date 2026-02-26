import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ReportsPage from './reports';

const mockExportToCsv = vi.fn();
const mockExportManagementPdf = vi.fn();

const reportState = vi.hoisted(() => ({
  byRange: {
    '24h': {
      timeRange: '24h',
      includeInfrastructure: false,
      excludeInfrastructure: true,
      containers: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          endpoint_id: 1,
          service_type: 'application',
          cpu: { avg: 45.5, min: 10, max: 92, p50: 44, p95: 88, p99: 91, samples: 100 },
          memory: { avg: 60.2, min: 30, max: 88, p50: 58, p95: 82, p99: 87, samples: 100 },
          memory_bytes: null,
        },
        {
          container_id: 'c2',
          container_name: 'edge-agent',
          endpoint_id: 1,
          service_type: 'infrastructure',
          cpu: { avg: 25, min: 5, max: 55, p50: 20, p95: 45, p99: 51, samples: 100 },
          memory: { avg: 30, min: 10, max: 60, p50: 25, p95: 50, p99: 55, samples: 100 },
          memory_bytes: null,
        },
      ],
      fleetSummary: {
        totalContainers: 2,
        avgCpu: 35.25,
        maxCpu: 92,
        avgMemory: 45.1,
        maxMemory: 88,
      },
      recommendations: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          service_type: 'application',
          issues: ['CPU over-utilized (avg > 80%) — consider increasing CPU limits'],
        },
      ],
    },
    '7d': {
      timeRange: '7d',
      includeInfrastructure: false,
      excludeInfrastructure: true,
      containers: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          endpoint_id: 1,
          service_type: 'application',
          cpu: { avg: 50, min: 10, max: 93, p50: 45, p95: 86, p99: 90, samples: 200 },
          memory: { avg: 62, min: 32, max: 90, p50: 58, p95: 84, p99: 88, samples: 200 },
          memory_bytes: null,
        },
        {
          container_id: 'c2',
          container_name: 'edge-agent',
          endpoint_id: 1,
          service_type: 'infrastructure',
          cpu: { avg: 25, min: 5, max: 55, p50: 20, p95: 45, p99: 51, samples: 200 },
          memory: { avg: 30, min: 10, max: 60, p50: 25, p95: 50, p99: 55, samples: 200 },
          memory_bytes: null,
        },
      ],
      fleetSummary: {
        totalContainers: 2,
        avgCpu: 37.5,
        maxCpu: 93,
        avgMemory: 46,
        maxMemory: 90,
      },
      recommendations: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          service_type: 'application',
          issues: ['CPU over-utilized (avg > 80%) — consider increasing CPU limits'],
        },
        {
          container_id: 'c2',
          container_name: 'edge-agent',
          service_type: 'infrastructure',
          issues: ['System container with elevated baseline load'],
        },
      ],
    },
    '30d': {
      timeRange: '30d',
      includeInfrastructure: false,
      excludeInfrastructure: true,
      containers: [],
      fleetSummary: {
        totalContainers: 0,
        avgCpu: 0,
        maxCpu: 0,
        avgMemory: 0,
        maxMemory: 0,
      },
      recommendations: [],
    },
  },
}));

vi.mock('@/shared/lib/csv-export', () => ({
  exportToCsv: (...args: unknown[]) => mockExportToCsv(...args),
}));
vi.mock('@/features/observability/lib/management-pdf-export', () => ({
  exportManagementPdf: (...args: unknown[]) => mockExportManagementPdf(...args),
  MANAGEMENT_PDF_THEMES: [
    { value: 'ocean', label: 'Ocean Blue' },
    { value: 'forest', label: 'Forest Green' },
    { value: 'slate', label: 'Slate Gray' },
    { value: 'sunset', label: 'Sunset Orange' },
  ],
}));

// Mock hooks
vi.mock('@/features/observability/hooks/use-reports', () => ({
  useUtilizationReport: vi.fn((timeRange: string, _endpointId?: number, _containerId?: string, excludeInfrastructure?: boolean) => {
    const source = reportState.byRange[timeRange as keyof typeof reportState.byRange];
    const shouldExclude = excludeInfrastructure ?? true;
    const containers = shouldExclude
      ? source.containers.filter((container) => container.service_type !== 'infrastructure')
      : source.containers;
    const recommendations = shouldExclude
      ? source.recommendations.filter((recommendation) => recommendation.service_type !== 'infrastructure')
      : source.recommendations;
    return {
      data: {
        ...source,
        includeInfrastructure: !shouldExclude,
        excludeInfrastructure: shouldExclude,
        containers,
        recommendations,
        fleetSummary: {
          ...source.fleetSummary,
          totalContainers: containers.length,
        },
      },
      isLoading: false,
    };
  }),
  useTrendsReport: vi.fn((timeRange: string) => ({
    data: timeRange === '7d'
      ? {
        timeRange: '7d',
        includeInfrastructure: false,
        excludeInfrastructure: true,
        trends: {
          cpu: [{ hour: '2025-01-01T10:00:00', avg: 45, max: 82, min: 5, samples: 140 }],
          memory: [{ hour: '2025-01-01T10:00:00', avg: 57, max: 72, min: 40, samples: 140 }],
          memory_bytes: [],
        },
      }
      : {
        timeRange: '24h',
        includeInfrastructure: false,
        excludeInfrastructure: true,
        trends: {
          cpu: [{ hour: '2025-01-01T10:00:00', avg: 40, max: 80, min: 5, samples: 60 }],
          memory: [{ hour: '2025-01-01T10:00:00', avg: 55, max: 70, min: 40, samples: 60 }],
          memory_bytes: [],
        },
      },
    isLoading: false,
  })),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(() => ({
    data: [{ id: 1, name: 'local' }],
    isLoading: false,
  })),
}));

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: vi.fn(() => ({
    data: [
      {
        id: 'c1',
        name: 'test-web',
        image: 'nginx:alpine',
        state: 'running',
        status: 'Up 2h',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: {},
        networks: [],
      },
      {
        id: 'c2',
        name: 'edge-agent',
        image: 'portainer/agent:latest',
        state: 'running',
        status: 'Up 2h',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: {},
        networks: [],
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
  })),
}));

// Mock chart component
vi.mock('@/shared/components/charts/metrics-line-chart', () => ({
  MetricsLineChart: () => <div data-testid="metrics-line-chart" />,
}));

vi.mock('@/shared/components/loading-skeleton', () => ({
  SkeletonCard: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportsPage', () => {
  beforeEach(() => {
    mockExportToCsv.mockReset();
    mockExportManagementPdf.mockReset();
    reportState.byRange['24h'].containers = [
      {
        container_id: 'c1',
        container_name: 'test-web',
        endpoint_id: 1,
        service_type: 'application',
        cpu: { avg: 45.5, min: 10, max: 92, p50: 44, p95: 88, p99: 91, samples: 100 },
        memory: { avg: 60.2, min: 30, max: 88, p50: 58, p95: 82, p99: 87, samples: 100 },
        memory_bytes: null,
      },
      {
        container_id: 'c2',
        container_name: 'edge-agent',
        endpoint_id: 1,
        service_type: 'infrastructure',
        cpu: { avg: 25, min: 5, max: 55, p50: 20, p95: 45, p99: 51, samples: 100 },
        memory: { avg: 30, min: 10, max: 60, p50: 25, p95: 50, p99: 55, samples: 100 },
        memory_bytes: null,
      },
    ];
    reportState.byRange['24h'].fleetSummary.totalContainers = 2;
    reportState.byRange['7d'].containers = [
      {
        container_id: 'c1',
        container_name: 'test-web',
        endpoint_id: 1,
        service_type: 'application',
        cpu: { avg: 50, min: 10, max: 93, p50: 45, p95: 86, p99: 90, samples: 200 },
        memory: { avg: 62, min: 32, max: 90, p50: 58, p95: 84, p99: 88, samples: 200 },
        memory_bytes: null,
      },
      {
        container_id: 'c2',
        container_name: 'edge-agent',
        endpoint_id: 1,
        service_type: 'infrastructure',
        cpu: { avg: 25, min: 5, max: 55, p50: 20, p95: 45, p99: 51, samples: 200 },
        memory: { avg: 30, min: 10, max: 60, p50: 25, p95: 50, p99: 55, samples: 200 },
        memory_bytes: null,
      },
    ];
    reportState.byRange['7d'].recommendations = [
      {
        container_id: 'c1',
        container_name: 'test-web',
        service_type: 'application',
        issues: ['CPU over-utilized (avg > 80%) — consider increasing CPU limits'],
      },
      {
        container_id: 'c2',
        container_name: 'edge-agent',
        service_type: 'infrastructure',
        issues: ['System container with elevated baseline load'],
      },
    ];
  });

  it('renders the page header', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('Resource Reports')).toBeTruthy();
    expect(screen.getByText(/Utilization analysis/)).toBeTruthy();
  });

  it('renders fleet summary KPIs', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('Containers')).toBeTruthy();
    expect(screen.getByText('Avg CPU')).toBeTruthy();
    expect(screen.getByText('Avg Memory')).toBeTruthy();
  });

  it('renders container utilization table', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('Application Services')).toBeTruthy();
    expect(screen.getAllByText('test-web').length).toBeGreaterThan(0);
  });

  it('renders recommendations section', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('Right-Sizing Recommendations')).toBeTruthy();
  });

  it('renders export CSV button', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('Export CSV')).toBeTruthy();
  });

  it('renders export management PDF button', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByRole('button', { name: /export management pdf/i })).toBeTruthy();
  });

  it('exports service-manager CSV rows with required fields', () => {
    renderWithProviders(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(mockExportToCsv).toHaveBeenCalledTimes(1);
    const [rows, filename] = mockExportToCsv.mock.calls[0];
    const first = (rows as Array<Record<string, unknown>>)[0];
    expect(first.container_name).toBe('test-web');
    expect(first.endpoint_name).toBe('local');
    expect(first.state).toBe('running');
    expect(first.stack).toBe('');
    expect(first.created_at).toBe('2023-11-14T22:13:20.000Z');
    expect(first.dienststelle).toBe('Standalone');
    expect(first.service_type).toBe('application');
    expect(filename).toMatch(/^resource-report-24h-all-endpoints-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('excludes infrastructure rows in CSV by default and includes them when toggled off', () => {
    renderWithProviders(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    let rows = mockExportToCsv.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].container_name).toBe('test-web');

    mockExportToCsv.mockClear();
    fireEvent.click(screen.getByLabelText(/exclude infrastructure services/i));
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    rows = mockExportToCsv.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[1].service_type).toBe('infrastructure');
  });

  it('disables CSV export when utilization metrics are empty', () => {
    reportState.byRange['24h'].containers = [];
    reportState.byRange['24h'].fleetSummary.totalContainers = 0;

    renderWithProviders(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(mockExportToCsv).not.toHaveBeenCalled();
  });

  it('renders time range selector buttons', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('24 Hours')).toBeTruthy();
    expect(screen.getByText('7 Days')).toBeTruthy();
    expect(screen.getByText('30 Days')).toBeTruthy();
  });

  it('renders trend charts', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('CPU Trend (Fleet Avg)')).toBeTruthy();
    expect(screen.getByText('Memory Trend (Fleet Avg)')).toBeTruthy();
  });

  it('exports management PDF with default 7d range and infrastructure excluded', () => {
    renderWithProviders(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: /export management pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }));

    expect(mockExportManagementPdf).toHaveBeenCalledTimes(1);
    const [payload, filename] = mockExportManagementPdf.mock.calls[0];
    expect(payload.timeRange).toBe('7d');
    expect(payload.includeInfrastructure).toBe(false);
    expect(payload.containers).toHaveLength(1);
    expect(payload.containers[0].container_name).toBe('test-web');
    expect(filename).toMatch(/^management-report-7d-all-endpoints-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('exports management PDF with overrides when selected', () => {
    renderWithProviders(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: /export management pdf/i }));
    fireEvent.click(screen.getAllByRole('button', { name: '24 Hours' })[1]);
    fireEvent.click(screen.getByLabelText(/^include infrastructure services$/i));
    fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }));

    expect(mockExportManagementPdf).toHaveBeenCalledTimes(1);
    const [payload, filename] = mockExportManagementPdf.mock.calls[0];
    expect(payload.timeRange).toBe('24h');
    expect(payload.includeInfrastructure).toBe(true);
    expect(payload.containers).toHaveLength(2);
    expect(filename).toMatch(/^management-report-24h-all-endpoints-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
