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

  it('renders the port mappings as a DataTable preserving every column and cell value', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          ports: [
            { private: 8080, public: 80, type: 'tcp' },
            { private: 53, type: 'udp' },
          ],
        }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Port Mappings' })).toBeInTheDocument();

    const table = screen.getByTestId('data-table');
    expect(table).toBeInTheDocument();

    // Headers preserved
    for (const header of ['Container Port', 'Host Port', 'Type', 'Host IP']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    // First row values
    expect(screen.getByText('8080')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('tcp')).toBeInTheDocument();

    // Missing public port renders the placeholder, and Host IP is constant
    expect(screen.getByText('53')).toBeInTheDocument();
    expect(screen.getByText('udp')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getAllByText('0.0.0.0')).toHaveLength(2);
  });

  it('omits the Port Mappings card when there are no ports', () => {
    render(<ContainerOverview container={baseContainer} />);

    expect(screen.queryByRole('heading', { name: 'Port Mappings' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });
});
