import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContainerOverview } from './container-overview';
import type { Container } from '@/hooks/use-containers';

const baseContainer: Container = {
  id: 'abc1234567890',
  name: 'db-redis',
  image: 'redis:7',
  state: 'running',
  status: 'Up 5 minutes',
  endpointId: 1,
  endpointName: 'local',
  ports: [],
  created: 1700000000,
  labels: {},
  networks: ['frontend', 'backend'],
};

describe('ContainerOverview', () => {
  it('renders image, endpoint, and networks cards in the shared info grid', () => {
    render(<ContainerOverview container={baseContainer} />);

    const infoGrid = screen.getByTestId('container-info-grid');
    expect(infoGrid.className).toContain('lg:grid-cols-3');
    expect(screen.getByText('Image Information')).toBeInTheDocument();
    expect(screen.getByText('Endpoint Information')).toBeInTheDocument();
    expect(screen.getByText('Networks')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('backend')).toBeInTheDocument();
  });

  it('shows empty networks copy when container has no networks', () => {
    render(<ContainerOverview container={{ ...baseContainer, networks: [] }} />);
    expect(screen.getByText('No networks attached')).toBeInTheDocument();
  });
});
