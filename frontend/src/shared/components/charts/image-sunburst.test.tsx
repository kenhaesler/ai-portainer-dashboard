import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageSunburst } from './image-sunburst';

describe('ImageSunburst', () => {
  it('should show empty state when no data', () => {
    render(<ImageSunburst data={[]} />);
    expect(screen.getByText('No image data')).toBeInTheDocument();
  });

  it('should not show empty state when data is provided', () => {
    const data = [
      { name: 'nginx', size: 100_000_000, registry: 'docker.io' },
      { name: 'redis', size: 50_000_000, registry: 'docker.io' },
    ];

    render(<ImageSunburst data={data} />);
    expect(screen.queryByText('No image data')).not.toBeInTheDocument();
  });

  it('does not render a legend that repeats the in-place slice labels', () => {
    const data = [
      { name: 'nginx', size: 100_000_000, registry: 'docker.io' },
      { name: 'app', size: 40_000_000, registry: 'ghcr.io' },
      { name: 'scanner', size: 10_000_000, registry: 'dhi.io' },
    ];

    const { container } = render(<ImageSunburst data={data} />);

    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull();
    expect(container.querySelector('.recharts-default-legend')).toBeNull();
  });
});
