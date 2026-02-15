import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ResourceOverviewCard,
  computeResourceAggregates,
} from './resource-overview-card';

const mockEndpoints = [
  { name: 'prod-1', totalCpu: 45.5, totalMemory: 62.3 },
  { name: 'prod-2', totalCpu: 30.2, totalMemory: 50.1 },
];

describe('computeResourceAggregates', () => {
  it('returns 0 for empty endpoints', () => {
    const result = computeResourceAggregates([]);
    expect(result.cpuPercent).toBe(0);
    expect(result.memoryPercent).toBe(0);
  });

  it('returns 0 as placeholder (TODO: implement proper aggregation)', () => {
    // Current implementation returns 0 because endpoint data only has capacity values,
    // not usage percentages. Proper implementation requires aggregating container stats.
    const result = computeResourceAggregates(mockEndpoints);
    expect(result.cpuPercent).toBe(0);
    expect(result.memoryPercent).toBe(0);
  });
});

describe('ResourceOverviewCard', () => {
  it('renders CPU and Memory labels', () => {
    render(<ResourceOverviewCard endpoints={mockEndpoints} />);
    expect(screen.getByText('Overall CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('Overall Memory Usage')).toBeInTheDocument();
  });

  it('shows 0% as placeholder (TODO: implement proper aggregation)', () => {
    render(<ResourceOverviewCard endpoints={mockEndpoints} />);
    const percentages = screen.getAllByText('0%');
    expect(percentages).toHaveLength(2);
  });

  it('progress bars show 0% width', () => {
    render(<ResourceOverviewCard endpoints={mockEndpoints} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveStyle({ width: '0%' });
    expect(bars[1]).toHaveStyle({ width: '0%' });
  });

  it('renders loading skeleton state', () => {
    const { container } = render(
      <ResourceOverviewCard endpoints={[]} isLoading />,
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(2);
    // Should not render actual labels during loading
    expect(screen.queryByText('Overall CPU Usage')).not.toBeInTheDocument();
  });

  it('renders two cards side-by-side (grid layout)', () => {
    const { container } = render(
      <ResourceOverviewCard endpoints={mockEndpoints} />,
    );
    const grid = container.firstChild as HTMLElement;
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('sm:grid-cols-2');
  });
});
