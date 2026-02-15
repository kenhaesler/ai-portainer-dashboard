import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceOverviewCard } from './resource-overview-card';

describe('ResourceOverviewCard', () => {
  it('renders CPU and Memory labels', () => {
    render(<ResourceOverviewCard cpuPercent={45.5} memoryPercent={62.3} />);
    expect(screen.getByText('Overall CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('Overall Memory Usage')).toBeInTheDocument();
  });

  it('shows correct percentage values', () => {
    render(<ResourceOverviewCard cpuPercent={45.5} memoryPercent={62.3} />);
    expect(screen.getByText('45.5%')).toBeInTheDocument();
    expect(screen.getByText('62.3%')).toBeInTheDocument();
  });

  it('progress bars match percentages', () => {
    render(<ResourceOverviewCard cpuPercent={45.5} memoryPercent={62.3} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveStyle({ width: '45.5%' });
    expect(bars[1]).toHaveStyle({ width: '62.3%' });
  });

  it('handles 0% values', () => {
    render(<ResourceOverviewCard cpuPercent={0} memoryPercent={0} />);
    const percentages = screen.getAllByText('0%');
    expect(percentages).toHaveLength(2);
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveStyle({ width: '0%' });
    expect(bars[1]).toHaveStyle({ width: '0%' });
  });

  it('clamps values at 100%', () => {
    render(<ResourceOverviewCard cpuPercent={100} memoryPercent={100} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveStyle({ width: '100%' });
  });

  it('renders loading skeleton state', () => {
    const { container } = render(
      <ResourceOverviewCard cpuPercent={0} memoryPercent={0} isLoading />,
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(2);
    // Should not render actual labels during loading
    expect(screen.queryByText('Overall CPU Usage')).not.toBeInTheDocument();
  });

  it('renders two cards side-by-side (grid layout)', () => {
    const { container } = render(
      <ResourceOverviewCard cpuPercent={45.5} memoryPercent={62.3} />,
    );
    const grid = container.firstChild as HTMLElement;
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('sm:grid-cols-2');
  });
});
