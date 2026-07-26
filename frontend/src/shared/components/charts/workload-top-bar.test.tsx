import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkloadTopBar, buildChartData } from './workload-top-bar';

// Mock recharts — keep all real exports, only replace ResponsiveContainer
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  };
});

function makeSeries(name: string, running: number, stopped: number, href?: string) {
  return { name, running, stopped, total: running + stopped, href };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('buildChartData', () => {
  it('returns empty array for no series', () => {
    expect(buildChartData([])).toEqual([]);
  });

  it('returns all rows when fewer than 8 (no Others row)', () => {
    const rows = buildChartData([
      makeSeries('A', 10, 2),  // total=12
      makeSeries('B', 8, 1),   // total=9
      makeSeries('C', 5, 3),   // total=8
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].label).toBe('A');
    expect(rows[1].label).toBe('B');
    expect(rows[2].label).toBe('C');
  });

  it('sorts by total descending', () => {
    const rows = buildChartData([
      makeSeries('Small', 2, 1),
      makeSeries('Big', 20, 5),
      makeSeries('Medium', 10, 3),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Big', 'Medium', 'Small']);
  });

  it('aggregates beyond top 8 into Others row', () => {
    const rows = buildChartData(
      Array.from({ length: 15 }, (_, i) => makeSeries(`EP-${i + 1}`, 20 + (15 - i), i)),
    );
    expect(rows).toHaveLength(9); // 8 + 1 Others
    const others = rows[8];
    expect(others.label).toBe('Others (7 more)');
    expect(others.href).toBeUndefined();
    expect(others.running).toBeGreaterThanOrEqual(0);
    expect(others.stopped).toBeGreaterThanOrEqual(0);
  });
});

describe('WorkloadTopBar', () => {
  it('shows empty state when the series is empty', () => {
    renderWithRouter(<WorkloadTopBar series={[]} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    renderWithRouter(<WorkloadTopBar series={[]} isLoading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders a chart for 5 series rows (no Others)', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeSeries(`Stack-${i + 1}`, 10 + i, i),
    );
    renderWithRouter(<WorkloadTopBar series={rows} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('renders a chart for 15 series rows', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeSeries(`Stack-${i + 1}`, 20 - i, i),
    );
    renderWithRouter(<WorkloadTopBar series={rows} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('handles a single series row', () => {
    renderWithRouter(
      <WorkloadTopBar series={[makeSeries('Solo', 5, 0)]} />,
    );
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('carries each row href through and drops it on the aggregated Others row', () => {
    // The chart used to navigate to `/endpoints/:id`, a route router.tsx does
    // not define — so on the one population that carried an id, clicking a bar
    // landed on the 404.
    const rows = buildChartData(
      Array.from({ length: 10 }, (_, i) =>
        makeSeries(`S-${i}`, 10 - i, 0, `/workloads?stack=S-${i}`),
      ),
    );
    expect(rows[0].href).toBe('/workloads?stack=S-0');
    expect(rows[rows.length - 1].label).toContain('Others');
    expect(rows[rows.length - 1].href).toBeUndefined();
  });

  it('does not claim a pointer affordance when no row is navigable', () => {
    const { container } = renderWithRouter(
      <WorkloadTopBar series={[makeSeries('Solo', 5, 0)]} />,
    );
    expect(container.querySelector('.cursor-pointer')).toBeNull();
  });
});
