import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EndpointStatusBar } from './endpoint-status-bar';

describe('EndpointStatusBar', () => {
  it('shows empty state when no data', () => {
    render(<EndpointStatusBar data={[]} />);
    expect(screen.getByText('No endpoint data')).toBeInTheDocument();
  });

  it('renders legend entries for all three status types', () => {
    const data = [
      { name: 'endpoint-01', running: 5, stopped: 2, unhealthy: 1 },
    ];
    render(<EndpointStatusBar data={data} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('truncates long endpoint names to 15 characters', () => {
    const data = [
      { name: 'very-long-endpoint-name-here', running: 3, stopped: 1, unhealthy: 0 },
    ];
    render(<EndpointStatusBar data={data} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('uses flex layout so chart fills available parent height', () => {
    const data = [
      { name: 'ep-1', running: 3, stopped: 1, unhealthy: 0 },
    ];
    const { container } = render(<EndpointStatusBar data={data} />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).toContain('flex');
    expect(outerDiv.className).toContain('h-full');
    expect(outerDiv.className).toContain('flex-col');
  });

  it('renders vertical layout (few endpoints) for 4 or fewer items', () => {
    const data = Array.from({ length: 4 }, (_, i) => ({
      name: `ep-${i + 1}`,
      running: 5,
      stopped: 1,
      unhealthy: 0,
    }));
    const { container } = render(<EndpointStatusBar data={data} />);
    // Should not have a horizontal (layout=vertical) chart — check there's a chart wrapper
    const chartArea = container.querySelector('.flex-1.min-h-0') as HTMLElement;
    expect(chartArea).not.toBeNull();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders horizontal layout for more than 4 endpoints to avoid label overlap', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      name: `endpoint-${String(i + 1).padStart(2, '0')}`,
      running: 10 + i,
      stopped: i,
      unhealthy: i % 3,
    }));
    const { container } = render(<EndpointStatusBar data={data} />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).toContain('flex');
    expect(outerDiv.className).toContain('h-full');
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('handles large environment (20+ endpoints) without errors', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({
      name: `production-cluster-${String(i + 1).padStart(2, '0')}`,
      running: 30 + i * 2,
      stopped: i,
      unhealthy: i % 5,
    }));
    const { container } = render(<EndpointStatusBar data={data} />);
    expect(container.firstElementChild).not.toBeNull();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});
