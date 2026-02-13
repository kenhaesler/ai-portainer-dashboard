import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ReportsPage from './reports';

// Mock hooks
vi.mock('@/hooks/use-reports', () => ({
  useUtilizationReport: vi.fn(() => ({
    data: {
      timeRange: '24h',
      containers: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          endpoint_id: 1,
          cpu: { avg: 45.5, min: 10, max: 92, p50: 44, p95: 88, p99: 91, samples: 100 },
          memory: { avg: 60.2, min: 30, max: 88, p50: 58, p95: 82, p99: 87, samples: 100 },
          memory_bytes: null,
        },
      ],
      fleetSummary: {
        totalContainers: 1,
        avgCpu: 45.5,
        maxCpu: 92,
        avgMemory: 60.2,
        maxMemory: 88,
      },
      recommendations: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          issues: ['CPU over-utilized (avg > 80%) — consider increasing CPU limits'],
        },
      ],
    },
    isLoading: false,
  })),
  useTrendsReport: vi.fn(() => ({
    data: {
      timeRange: '24h',
      trends: {
        cpu: [{ hour: '2025-01-01T10:00:00', avg: 40, max: 80, min: 5, samples: 60 }],
        memory: [{ hour: '2025-01-01T10:00:00', avg: 55, max: 70, min: 40, samples: 60 }],
        memory_bytes: [],
      },
    },
    isLoading: false,
  })),
}));

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(() => ({
    data: [{ id: 1, name: 'local' }],
    isLoading: false,
  })),
}));

// Mock chart component
vi.mock('@/components/charts/metrics-line-chart', () => ({
  MetricsLineChart: () => <div data-testid="metrics-line-chart" />,
}));

vi.mock('@/components/shared/loading-skeleton', () => ({
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
    expect(screen.getByText('Container Utilization')).toBeTruthy();
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

  it('triggers CSV download when export button is clicked', () => {
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:resource-report');
    const mockRevokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    renderWithProviders(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:resource-report');

    clickSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
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
});
