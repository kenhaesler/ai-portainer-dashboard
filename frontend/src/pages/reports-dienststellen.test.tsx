import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DienststellenOverview } from './reports';
import type { Endpoint } from '@/hooks/use-endpoints';
import type { Container } from '@/hooks/use-containers';

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 1,
    name: 'Dienststelle-A',
    type: 1,
    url: 'tcp://10.0.0.1:9001',
    status: 'up',
    containersRunning: 2,
    containersStopped: 1,
    containersHealthy: 2,
    containersUnhealthy: 0,
    totalContainers: 3,
    stackCount: 1,
    totalCpu: 4,
    totalMemory: 8589934592,
    isEdge: false,
    edgeMode: null,
    snapshotAge: null,
    checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'abc123',
    name: 'web-app',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 hours',
    endpointId: 1,
    endpointName: 'Dienststelle-A',
    ports: [],
    created: Date.now() / 1000,
    labels: {},
    networks: [],
    ...overrides,
  };
}

describe('DienststellenOverview', () => {
  it('renders nothing when no endpoints', () => {
    const { container } = render(
      <DienststellenOverview endpoints={undefined} containers={undefined} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when endpoints array is empty', () => {
    const { container } = render(
      <DienststellenOverview endpoints={[]} containers={[]} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows total Dienststellen count', () => {
    const endpoints = [
      makeEndpoint({ id: 1, name: 'Berlin' }),
      makeEndpoint({ id: 2, name: 'Munich' }),
      makeEndpoint({ id: 3, name: 'Hamburg' }),
    ];

    render(<DienststellenOverview endpoints={endpoints} containers={[]} />);

    expect(screen.getByText('Total Dienststellen')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows total containers count', () => {
    const endpoints = [makeEndpoint({ id: 1, name: 'Berlin' })];
    const containers = [
      makeContainer({ id: 'c1', name: 'app-1', endpointId: 1 }),
      makeContainer({ id: 'c2', name: 'app-2', endpointId: 1 }),
    ];

    render(<DienststellenOverview endpoints={endpoints} containers={containers} />);

    expect(screen.getByText('Total Containers')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows containers grouped by Dienststelle', () => {
    const endpoints = [
      makeEndpoint({ id: 1, name: 'Berlin' }),
      makeEndpoint({ id: 2, name: 'Munich' }),
    ];
    const containers = [
      makeContainer({ id: 'c1', name: 'web', endpointId: 1 }),
      makeContainer({ id: 'c2', name: 'api', endpointId: 1 }),
      makeContainer({ id: 'c3', name: 'db', endpointId: 2 }),
    ];

    render(<DienststellenOverview endpoints={endpoints} containers={containers} />);

    // Both Dienststellen shown
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('Munich')).toBeInTheDocument();

    // Container counts shown
    expect(screen.getByText('2 total')).toBeInTheDocument(); // Berlin
    expect(screen.getByText('1 total')).toBeInTheDocument(); // Munich
  });

  it('expands to show container list on click', () => {
    const endpoints = [makeEndpoint({ id: 1, name: 'Berlin' })];
    const containers = [
      makeContainer({ id: 'c1', name: 'web-server', endpointId: 1, image: 'nginx:1.25' }),
      makeContainer({ id: 'c2', name: 'api-service', endpointId: 1, image: 'node:20', state: 'stopped' }),
    ];

    render(<DienststellenOverview endpoints={endpoints} containers={containers} />);

    // Containers not visible initially
    expect(screen.queryByText('web-server')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('Berlin'));

    // Now containers are visible
    expect(screen.getByText('web-server')).toBeInTheDocument();
    expect(screen.getByText('api-service')).toBeInTheDocument();
    expect(screen.getByText('nginx:1.25')).toBeInTheDocument();
    expect(screen.getByText('node:20')).toBeInTheDocument();
  });

  it('collapses on second click', () => {
    const endpoints = [makeEndpoint({ id: 1, name: 'Berlin' })];
    const containers = [makeContainer({ id: 'c1', name: 'my-app', endpointId: 1 })];

    render(<DienststellenOverview endpoints={endpoints} containers={containers} />);

    // Expand
    fireEvent.click(screen.getByText('Berlin'));
    expect(screen.getByText('my-app')).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Berlin'));
    expect(screen.queryByText('my-app')).not.toBeInTheDocument();
  });

  it('shows running/stopped counts per Dienststelle', () => {
    const endpoints = [makeEndpoint({ id: 1, name: 'Berlin' })];
    const containers = [
      makeContainer({ id: 'c1', name: 'app-1', endpointId: 1, state: 'running' }),
      makeContainer({ id: 'c2', name: 'app-2', endpointId: 1, state: 'running' }),
      makeContainer({ id: 'c3', name: 'app-3', endpointId: 1, state: 'stopped' }),
    ];

    render(<DienststellenOverview endpoints={endpoints} containers={containers} />);

    expect(screen.getByText('2 running')).toBeInTheDocument();
    expect(screen.getByText('1 stopped')).toBeInTheDocument();
    expect(screen.getByText('3 total')).toBeInTheDocument();
  });

  it('shows Edge badge for Edge endpoints', () => {
    const endpoints = [makeEndpoint({ id: 1, name: 'Remote-Office', isEdge: true, edgeMode: 'standard' })];

    render(<DienststellenOverview endpoints={endpoints} containers={[]} />);

    expect(screen.getByText('Edge')).toBeInTheDocument();
  });

  it('shows empty message when Dienststelle has no containers', () => {
    const endpoints = [makeEndpoint({ id: 1, name: 'Berlin' })];

    render(<DienststellenOverview endpoints={endpoints} containers={[]} />);

    // Expand
    fireEvent.click(screen.getByText('Berlin'));
    expect(screen.getByText('No containers on this Dienststelle')).toBeInTheDocument();
  });

  it('sorts Dienststellen alphabetically', () => {
    const endpoints = [
      makeEndpoint({ id: 3, name: 'Zurich' }),
      makeEndpoint({ id: 1, name: 'Berlin' }),
      makeEndpoint({ id: 2, name: 'Munich' }),
    ];

    render(<DienststellenOverview endpoints={endpoints} containers={[]} />);

    const buttons = screen.getAllByRole('button');
    const names = buttons.map((b) => b.textContent);
    const zurichIdx = names.findIndex((n) => n?.includes('Zurich'));
    const berlinIdx = names.findIndex((n) => n?.includes('Berlin'));
    const munichIdx = names.findIndex((n) => n?.includes('Munich'));

    expect(berlinIdx).toBeLessThan(munichIdx);
    expect(munichIdx).toBeLessThan(zurichIdx);
  });
});
