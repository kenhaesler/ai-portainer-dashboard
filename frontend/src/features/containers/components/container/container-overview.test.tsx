import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContainerOverview } from './container-overview';

const baseContainer = {
  id: 'abc123def456',
  name: 'api-1',
  image: 'ghcr.io/example/api:latest',
  state: 'running',
  status: 'Up 5 minutes',
  endpointId: 1,
  endpointName: 'local',
  ports: [],
  created: Math.floor(Date.now() / 1000) - 300,
  labels: {},
  networks: ['frontend', 'backend'],
};

describe('ContainerOverview', () => {
  it('places image, endpoint, and networks cards in the same responsive row grid', () => {
    render(<ContainerOverview container={baseContainer} />);

    const imageHeading = screen.getByRole('heading', { name: 'Image Information' });
    const rowGrid = imageHeading.closest('div.grid');

    expect(rowGrid).toHaveClass('grid-cols-1');
    expect(rowGrid).toHaveClass('lg:grid-cols-3');
    expect(screen.getByRole('heading', { name: 'Endpoint Information' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Networks' })).toBeInTheDocument();
  });
});
