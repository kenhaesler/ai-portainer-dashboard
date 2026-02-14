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

function makeEndpoint(id: number, name: string, running: number, stopped: number) {
  return { id, name, running, stopped, total: running + stopped };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('buildChartData', () => {
  it('returns empty array for no endpoints', () => {
    expect(buildChartData([])).toEqual([]);
  });

  it('returns all endpoints when fewer than 10 (no Others row)', () => {
    const endpoints = [
      makeEndpoint(1, 'A', 10, 2),  // total=12
      makeEndpoint(2, 'B', 8, 1),   // total=9
      makeEndpoint(3, 'C', 5, 3),   // total=8
    ];
    const rows = buildChartData(endpoints);
    expect(rows).toHaveLength(3);
    expect(rows[0].label).toBe('A');
    expect(rows[1].label).toBe('B');
    expect(rows[2].label).toBe('C');
  });

  it('sorts by total descending', () => {
    const endpoints = [
      makeEndpoint(1, 'Small', 2, 1),
      makeEndpoint(2, 'Big', 20, 5),
      makeEndpoint(3, 'Medium', 10, 3),
    ];
    const rows = buildChartData(endpoints);
    expect(rows.map((r) => r.label)).toEqual(['Big', 'Medium', 'Small']);
  });

  it('aggregates beyond top 10 into Others row', () => {
    const endpoints = Array.from({ length: 15 }, (_, i) =>
      makeEndpoint(i + 1, `EP-${i + 1}`, 20 + (15 - i), i),
    );
    const rows = buildChartData(endpoints);
    expect(rows).toHaveLength(11); // 10 + 1 Others
    const others = rows[10];
    expect(others.label).toBe('Others (5 more)');
    expect(others.endpointId).toBeUndefined();
    expect(others.running).toBeGreaterThanOrEqual(0);
    expect(others.stopped).toBeGreaterThanOrEqual(0);
  });
});

describe('WorkloadTopBar', () => {
  it('shows empty state when no endpoints', () => {
    renderWithRouter(<WorkloadTopBar endpoints={[]} />);
    expect(screen.getByText('No workload data')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    renderWithRouter(<WorkloadTopBar endpoints={[]} isLoading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders chart with 5 endpoints (no Others)', () => {
    const endpoints = Array.from({ length: 5 }, (_, i) =>
      makeEndpoint(i + 1, `Endpoint-${i + 1}`, 10 + i, i),
    );
    renderWithRouter(<WorkloadTopBar endpoints={endpoints} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('renders chart with 15 endpoints', () => {
    const endpoints = Array.from({ length: 15 }, (_, i) =>
      makeEndpoint(i + 1, `Endpoint-${i + 1}`, 20 - i, i),
    );
    renderWithRouter(<WorkloadTopBar endpoints={endpoints} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('handles single endpoint', () => {
    renderWithRouter(
      <WorkloadTopBar endpoints={[makeEndpoint(1, 'Solo', 5, 0)]} />,
    );
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });
});
