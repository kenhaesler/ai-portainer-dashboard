import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageTreemap } from './image-treemap';

describe('ImageTreemap', () => {
  it('should show empty state when no data', () => {
    render(<ImageTreemap data={[]} />);
    expect(screen.getByText('No image data')).toBeInTheDocument();
  });

  it('should not show empty state when data is provided', () => {
    const data = [
      { name: 'nginx', size: 100_000_000 },
      { name: 'redis', size: 50_000_000 },
    ];

    render(<ImageTreemap data={data} />);
    expect(screen.queryByText('No image data')).not.toBeInTheDocument();
  });
});
