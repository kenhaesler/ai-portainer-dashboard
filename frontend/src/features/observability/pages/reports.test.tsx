import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ReportsPage from './reports';

const mockExportToCsv = vi.fn();
const mockExportManagementPdf = vi.fn();

/**
 * The right-sizing rules the backend could not evaluate over a range, and how
 * many rules exist. Percentiles are computed on 6h and below only, so on every
 * longer range the two p95-keyed rules go quiet for every container.
 */
const COVERAGE_ROLLUP = {
  totalRules: 4,
  skippedRules: [
    { id: 'cpu-underutilized', metric: 'cpu', statistic: 'p95', comparison: 'below', threshold: 10, unit: 'percent', recommendation: 'consider reducing CPU limits' },
    { id: 'memory-underutilized', metric: 'memory', statistic: 'p95', comparison: 'below', threshold: 20, unit: 'percent', recommendation: 'consider reducing memory limits' },
  ],
  skippedReason: 'Percentiles are not computed over 24h, so a rule keyed on p95 has no value to test.',
};

const reportState = vi.hoisted(() => ({
  byRange: {
    // 6h is the only range that reads the raw metrics table, so it is the only
    // one whose fixture may show a p95 rule firing.
    '6h': {
      timeRange: '6h',
      includeInfrastructure: false,
      excludeInfrastructure: true,
      containers: [
        {
          container_id: 'c1',
          container_name: 'test-web',
          endpoint_id: 1,
          service_type: 'application',
          cpu: { avg: 4, min: 1, max: 9, p50: 3, p95: 6, p99: 8, samples: 360 },
          memory: { avg: 8, min: 4, max: 15, p50: 7, p95: 12, p99: 14, samples: 360 },
          memory_bytes: null,
        },
      ],
      fleetSummary: {
        totalContainers: 1,
        avgCpu: 4,
        maxCpu: 9,
        avgMemory: 8,
        maxMemory: 15,
      },
      recommendations: [],
      recommendationSummary: [
        {
          id: 'cpu-underutilized',
          metric: 'cpu',
          statistic: 'p95',
          comparison: 'below',
          threshold: 10,
          unit: 'percent',
          recommendation: 'consider reducing CPU limits',
          container_count: 1,
          container_names: ['test-web'],
        },
      ] as Array<Record<string, unknown>> | undefined,
      rightSizingCoverage: {
        totalRules: 4,
        skippedRules: [],
        skippedReason: null,
      } as unknown,
    },
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
      // Per-rule rollup the backend ships alongside `recommendations`, so the
      // page can state a rule once instead of once per matching container. An
      // `avg` rule: 24h is a rollup range, where a p95 rule cannot fire at all.
      recommendationSummary: [
        {
          id: 'cpu-overutilized',
          metric: 'cpu',
          statistic: 'avg',
          comparison: 'above',
          threshold: 80,
          unit: 'percent',
          recommendation: 'consider increasing CPU limits',
          container_count: 2,
          container_names: ['web-1', 'web-2'],
        },
      ] as Array<Record<string, unknown>> | undefined,
      rightSizingCoverage: undefined as unknown,
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
// reports.tsx loads this module via dynamic import() inside the export handler
// (#1507); vi.mock intercepts dynamic imports too. The theme list now comes
// from the real (light) management-pdf-themes module and is not mocked.
vi.mock('@/features/observability/lib/management-pdf-export', () => ({
  exportManagementPdf: (...args: unknown[]) => mockExportManagementPdf(...args),
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
      // One container that follows the `<department>_<office>_<stack>`
      // convention, so the taxonomy panel renders (it returns null when no
      // stack parses).
      {
        id: 'c3',
        name: 'berlin-web',
        image: 'nginx:alpine',
        state: 'running',
        status: 'Up 2h',
        endpointId: 1,
        endpointName: 'local',
        ports: [],
        created: 1700000000,
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
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
    reportState.byRange['24h'].recommendationSummary = [
      {
        id: 'cpu-overutilized',
        metric: 'cpu',
        statistic: 'avg',
        comparison: 'above',
        threshold: 80,
        unit: 'percent',
        recommendation: 'consider increasing CPU limits',
        container_count: 2,
        container_names: ['web-1', 'web-2'],
      },
    ];
    reportState.byRange['24h'].rightSizingCoverage = COVERAGE_ROLLUP;
    reportState.byRange['24h'].recommendations = [
      {
        container_id: 'c1',
        container_name: 'test-web',
        service_type: 'application',
        issues: ['CPU over-utilized (avg > 80%) — consider increasing CPU limits'],
      },
    ];
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

  it('renders one PageHeader whose title matches the nav label', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    // The old subtitle listed the page's own sections; this one carries state.
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '1 container over the last 24 hours',
    );
    expect(screen.queryByText(/Utilization analysis/)).not.toBeInTheDocument();
  });

  it('formats the container count as an integer and names the CPU denominator', () => {
    renderWithProviders(<ReportsPage />);
    // A COUNT used to render as "13.0" because every stat went through toFixed(1).
    expect(screen.queryByText('1.0')).not.toBeInTheDocument();
    expect(screen.getAllByText('100% = one core').length).toBe(2);
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

  it('renders the utilization DataTable with shared column headers', () => {
    renderWithProviders(<ReportsPage />);
    // At least one shared DataTable instance exists (utilization table).
    expect(screen.getAllByTestId('data-table').length).toBeGreaterThan(0);
    // Utilization-specific column headers are present.
    expect(screen.getByText('CPU Avg')).toBeTruthy();
    expect(screen.getByText('CPU p95')).toBeTruthy();
    expect(screen.getByText('Mem Avg')).toBeTruthy();
    expect(screen.getByText('Samples')).toBeTruthy();
  });

  it('toggles sort direction on the shared utilization column header', () => {
    // The header used to be a `<span onClick>` carrying a text arrow, with
    // `aria-sort` null on every `<th>` and nothing tabbable — the table could
    // not be sorted by keyboard at all, and five of its eight headers looked
    // sortable while doing nothing. It is now a real DataTable column, so the
    // contract to assert is the accessible one.
    renderWithProviders(<ReportsPage />);

    const cpuHeaderCell = screen.getAllByRole('columnheader', { name: /CPU Avg/ })[0];
    expect(cpuHeaderCell).toHaveAttribute('aria-sort', 'none');

    const cpuButton = within(cpuHeaderCell).getByRole('button');

    // A numeric column sorts descending first — highest CPU at the top is what
    // an operator opens this table for — then reverses.
    fireEvent.click(cpuButton);
    const firstDirection = cpuHeaderCell.getAttribute('aria-sort');
    expect(firstDirection).toBe('descending');

    fireEvent.click(cpuButton);
    expect(cpuHeaderCell).toHaveAttribute('aria-sort', 'ascending');
  });

  it('exposes every utilization column as a keyboard-operable sort control', () => {
    // CPU p95, CPU Max, Mem p95, Mem Max and Samples were visually identical
    // to the sortable headers and inert.
    renderWithProviders(<ReportsPage />);

    for (const name of ['Container', 'CPU Avg', 'CPU p95', 'CPU Max', 'Mem Avg', 'Mem p95', 'Mem Max', 'Samples']) {
      const cell = screen.getAllByRole('columnheader', { name: new RegExp(name) })[0];
      expect(cell, `${name} header cell`).toHaveAttribute('aria-sort');
      expect(within(cell).getByRole('button'), `${name} sort button`).toBeTruthy();
    }
  });

  it('renders the office DataTable when a group is expanded', () => {
    renderWithProviders(<ReportsPage />);
    const before = screen.getAllByTestId('data-table').length;
    // Expand the "Standalone" group (two mock containers have no stack label).
    fireEvent.click(screen.getByRole('button', { name: /Standalone/i }));
    const after = screen.getAllByTestId('data-table').length;
    expect(after).toBeGreaterThan(before);
    // The grouped table exposes its own column set.
    expect(screen.getByText('Stack')).toBeTruthy();
    expect(screen.getByText('Env')).toBeTruthy();
    expect(screen.getByText('Image')).toBeTruthy();
  });

  it('states each right-sizing rule once with a container count, not once per container', () => {
    renderWithProviders(<ReportsPage />);

    expect(screen.getByText('Right-sizing rules')).toBeTruthy();
    // Two containers, both matching the same rule → one line, not two.
    const lines = screen.getAllByTestId('right-sizing-rule');
    expect(lines).toHaveLength(1);
    expect(screen.getByText('2 containers')).toBeInTheDocument();
    expect(screen.getByText(/CPU avg above 80% — consider increasing CPU limits/)).toBeInTheDocument();
    expect(screen.getByText('web-1, web-2')).toBeInTheDocument();
  });

  it('counts with container_count, not the capped name sample', () => {
    // The backend caps `container_names` at 500 but leaves `container_count`
    // the real total. Counting the array would report "500 containers" for a
    // fleet of 525 — an under-count presented as fact, on exactly the large
    // fleet the cap exists for.
    reportState.byRange['24h'].recommendationSummary = [
      {
        id: 'cpu-overutilized',
        metric: 'cpu',
        statistic: 'avg',
        comparison: 'above',
        threshold: 80,
        unit: 'percent',
        recommendation: 'consider increasing CPU limits',
        container_count: 525,
        container_names: Array.from({ length: 500 }, (_, i) => `svc-${i}`),
        names_truncated: true,
      },
    ];
    renderWithProviders(<ReportsPage />);

    expect(screen.getByText('525 containers')).toBeInTheDocument();
    expect(screen.queryByText('500 containers')).not.toBeInTheDocument();
    // "and N more" is relative to the true total too.
    expect(screen.getByText(/and 519 more/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Half the right-sizing engine is range-dependent. `evaluateRightSizingRules`
  // skips a rule whose statistic is null, so on any range above 6h the two
  // p95-keyed rules go quiet for every container — and the panel used to
  // present the survivors as the whole engine.
  // ---------------------------------------------------------------------------

  it('states which right-sizing rules the selected range could not evaluate', () => {
    renderWithProviders(<ReportsPage />);

    const note = screen.getByTestId('right-sizing-coverage-note');
    // The fraction comes from the payload — hard-coding "2 of 4" here would
    // stop being true the moment a fifth rule is added.
    expect(note).toHaveTextContent('2 of 4 rules could not be evaluated');
    expect(note).toHaveTextContent('CPU p95 below 10%, Memory p95 below 20%');
    expect(note).toHaveTextContent(
      'Percentiles are not computed over 24h, so a rule keyed on p95 has no value to test.',
    );
  });

  it('shows the panel for the unevaluated rules even when no rule fired', () => {
    // The panel rendered only when a rule fired, so a range that disabled two
    // rules and matched none with the other two said nothing at all.
    reportState.byRange['24h'].recommendationSummary = [];
    reportState.byRange['24h'].recommendations = [];
    renderWithProviders(<ReportsPage />);

    expect(screen.queryAllByTestId('right-sizing-rule')).toHaveLength(0);
    expect(screen.getByText('Right-sizing rules')).toBeInTheDocument();
    expect(screen.getByTestId('right-sizing-coverage-note')).toHaveTextContent(
      '2 of 4 rules could not be evaluated',
    );
  });

  it('labels the header count and drops the list description when nothing fired', () => {
    // Since the panel renders on skipped rules alone, its header pill could
    // show a bare "0" above "2 of 4 rules could not be evaluated", under a
    // paragraph describing a list that was not there.
    reportState.byRange['24h'].recommendationSummary = [];
    reportState.byRange['24h'].recommendations = [];
    renderWithProviders(<ReportsPage />);

    expect(screen.getByTestId('right-sizing-fired-count')).toHaveTextContent('0 fired');
    expect(screen.queryByText(/One line per rule that fired/)).not.toBeInTheDocument();
    expect(screen.getByText(/None produced advice over this range/)).toBeInTheDocument();
  });

  it('labels the header count when rules did fire', () => {
    renderWithProviders(<ReportsPage />);

    expect(screen.getByTestId('right-sizing-fired-count')).toHaveTextContent('1 fired');
    // The list description belongs with a list.
    expect(screen.getByText(/One line per rule that fired/)).toBeInTheDocument();
  });

  it('hides the note against a server that does not send coverage', () => {
    reportState.byRange['24h'].rightSizingCoverage = undefined;
    renderWithProviders(<ReportsPage />);

    expect(screen.queryByTestId('right-sizing-coverage-note')).not.toBeInTheDocument();
    // The rules that did fire are unaffected.
    expect(screen.getAllByTestId('right-sizing-rule')).toHaveLength(1);
  });

  it('drops the note on 6 Hours, the one range that can evaluate every rule', () => {
    renderWithProviders(<ReportsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '6 Hours' })[0]);

    expect(screen.queryByTestId('right-sizing-coverage-note')).not.toBeInTheDocument();
    // ...and a p95-keyed rule can finally fire.
    expect(screen.getByText(/CPU p95 below 10% — consider reducing CPU limits/)).toBeInTheDocument();
  });

  it('falls back to grouping the legacy per-container issue strings', () => {
    // Backend that predates the rollup: no `recommendationSummary`.
    reportState.byRange['24h'].recommendationSummary = undefined;
    renderWithProviders(<ReportsPage />);

    const lines = screen.getAllByTestId('right-sizing-rule');
    expect(lines).toHaveLength(1);
    expect(
      screen.getByText(/CPU over-utilized \(avg > 80%\) — consider increasing CPU limits/),
    ).toBeInTheDocument();
  });

  it('renders export CSV button', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('Export CSV')).toBeTruthy();
  });

  it('renders the PDF export button', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByRole('button', { name: /export pdf report/i })).toBeTruthy();
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
    // 6 Hours is the only range the backend reads raw metrics for, so it is
    // the only one that returns percentiles at all. Without it the p95 column
    // is a dash on every reachable range.
    expect(screen.getByText('6 Hours')).toBeTruthy();
    expect(screen.getByText('24 Hours')).toBeTruthy();
    expect(screen.getByText('7 Days')).toBeTruthy();
    expect(screen.getByText('30 Days')).toBeTruthy();
  });

  it('renders trend charts', () => {
    renderWithProviders(<ReportsPage />);
    expect(screen.getByText('CPU Trend (Fleet Avg)')).toBeTruthy();
    expect(screen.getByText('Memory Trend (Fleet Avg)')).toBeTruthy();
  });

  it('inherits the page time range and infrastructure filter when opened', async () => {
    renderWithProviders(<ReportsPage />);

    // Page filter is 24h with infrastructure excluded; the panel used to reset
    // to 7d and phrase the same filter with the opposite polarity.
    fireEvent.click(screen.getByRole('button', { name: /export pdf report/i }));
    expect(screen.getAllByLabelText(/^exclude infrastructure services$/i)).toHaveLength(2);
    expect(screen.queryByLabelText(/include infrastructure services/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }));

    // The export module is loaded via dynamic import() in the handler (#1507),
    // so the mocked export function is called asynchronously.
    await waitFor(() => expect(mockExportManagementPdf).toHaveBeenCalledTimes(1));
    const [payload, filename] = mockExportManagementPdf.mock.calls[0];
    expect(payload.timeRange).toBe('24h');
    expect(payload.includeInfrastructure).toBe(false);
    expect(payload.containers).toHaveLength(1);
    expect(payload.containers[0].container_name).toBe('test-web');
    expect(filename).toMatch(/^management-report-24h-all-endpoints-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('exports management PDF with overrides when selected', async () => {
    renderWithProviders(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: /export pdf report/i }));
    fireEvent.click(screen.getAllByRole('button', { name: '7 Days' })[1]);
    // Second checkbox is the panel's own copy of the page filter.
    fireEvent.click(screen.getAllByLabelText(/^exclude infrastructure services$/i)[1]);
    fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }));

    await waitFor(() => expect(mockExportManagementPdf).toHaveBeenCalledTimes(1));
    const [payload, filename] = mockExportManagementPdf.mock.calls[0];
    expect(payload.timeRange).toBe('7d');
    expect(payload.includeInfrastructure).toBe(true);
    expect(payload.containers).toHaveLength(2);
    expect(filename).toMatch(/^management-report-7d-all-endpoints-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
