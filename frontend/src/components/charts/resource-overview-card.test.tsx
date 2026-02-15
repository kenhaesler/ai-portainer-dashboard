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
  it('computes average CPU and memory across endpoints', () => {
    const result = computeResourceAggregates(mockEndpoints);
    // (45.5 + 30.2) / 2 = 37.85
    expect(result.cpuPercent).toBe(37.85);
    // (62.3 + 50.1) / 2 = 56.2
    expect(result.memoryPercent).toBe(56.2);
  });

  it('returns 0 for empty endpoints', () => {
    const result = computeResourceAggregates([]);
    expect(result.cpuPercent).toBe(0);
    expect(result.memoryPercent).toBe(0);
  });

  it('handles single endpoint', () => {
    const result = computeResourceAggregates([mockEndpoints[0]]);
    expect(result.cpuPercent).toBe(45.5);
    expect(result.memoryPercent).toBe(62.3);
  });

  it('handles endpoints with 0% usage', () => {
    const result = computeResourceAggregates([
      { name: 'idle', totalCpu: 0, totalMemory: 0 },
    ]);
    expect(result.cpuPercent).toBe(0);
    expect(result.memoryPercent).toBe(0);
  });

  it('handles endpoints at 100% usage', () => {
    const result = computeResourceAggregates([
      { name: 'full', totalCpu: 100, totalMemory: 100 },
    ]);
    expect(result.cpuPercent).toBe(100);
    expect(result.memoryPercent).toBe(100);
  });
});

describe('ResourceOverviewCard', () => {
  it('renders CPU and Memory labels', () => {
    render(<ResourceOverviewCard endpoints={mockEndpoints} />);
    expect(screen.getByText('Overall CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('Overall Memory Usage')).toBeInTheDocument();
  });

  it('shows correct percentage values', () => {
    render(<ResourceOverviewCard endpoints={mockEndpoints} />);
    expect(screen.getByText('37.85%')).toBeInTheDocument();
    expect(screen.getByText('56.2%')).toBeInTheDocument();
  });

  it('progress bar width matches percentage', () => {
    render(<ResourceOverviewCard endpoints={mockEndpoints} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveStyle({ width: '37.85%' });
    expect(bars[1]).toHaveStyle({ width: '56.2%' });
  });

  it('handles 0% edge case', () => {
    const idle = [{ name: 'idle', totalCpu: 0, totalMemory: 0 }];
    render(<ResourceOverviewCard endpoints={idle} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveStyle({ width: '0%' });
    expect(bars[1]).toHaveStyle({ width: '0%' });
  });

  it('clamps progress bar at 100%', () => {
    const full = [{ name: 'full', totalCpu: 100, totalMemory: 100 }];
    render(<ResourceOverviewCard endpoints={full} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveStyle({ width: '100%' });
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
