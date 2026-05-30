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
});
