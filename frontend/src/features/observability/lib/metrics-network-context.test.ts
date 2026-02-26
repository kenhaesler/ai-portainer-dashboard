import { describe, expect, it } from 'vitest';
import { buildMetricsNetworkContext } from './metrics-network-context';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Network } from '@/features/containers/hooks/use-networks';

function makeContainer(overrides: Partial<Container> & { id: string; name: string }): Container {
  return {
    id: overrides.id,
    name: overrides.name,
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 1 hour',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 1700000000,
    labels: {},
    networks: [],
    ...overrides,
  };
}

function makeNetwork(overrides: Partial<Network> & { id: string; name: string; containers: string[] }): Network {
  return {
    id: overrides.id,
    name: overrides.name,
    endpointId: 1,
    endpointName: 'local',
    containers: overrides.containers,
    ...overrides,
  };
}

describe('buildMetricsNetworkContext', () => {
  const containers = [
    makeContainer({ id: 'c1', name: 'api-1', labels: { 'com.docker.compose.project': 'alpha' }, networks: ['frontend'] }),
    makeContainer({ id: 'c2', name: 'worker-1', labels: { 'com.docker.compose.project': 'alpha' }, networks: ['frontend', 'jobs'] }),
    makeContainer({ id: 'c3', name: 'db-1', labels: { 'com.docker.compose.project': 'beta' }, networks: ['db-net'] }),
  ];
  const networks = [
    makeNetwork({ id: 'n1', name: 'frontend', containers: ['c1', 'c2'] }),
    makeNetwork({ id: 'n2', name: 'jobs', containers: ['c2'] }),
    makeNetwork({ id: 'n3', name: 'db-net', containers: ['c3'] }),
  ];

  it('scopes to selected container neighborhood in container mode', () => {
    const result = buildMetricsNetworkContext({
      containers,
      networks,
      scope: 'container',
      selectedContainerId: 'c1',
      selectedStack: null,
      knownStackNames: ['alpha', 'beta'],
    });

    expect(result.containers.map((container) => container.id)).toEqual(['c1', 'c2']);
    expect(result.networks.map((network) => network.id)).toEqual(['n1']);
    expect(result.relatedNodeIds).toContain('container-c2');
    expect(result.relatedNodeIds).toContain('net-n1');
  });

  it('scopes to selected stack in stack mode', () => {
    const result = buildMetricsNetworkContext({
      containers,
      networks,
      scope: 'stack',
      selectedContainerId: null,
      selectedStack: 'alpha',
      knownStackNames: ['alpha', 'beta'],
    });

    expect(result.containers.map((container) => container.id)).toEqual(['c1', 'c2']);
    expect(result.networks.map((network) => network.id)).toEqual(['n1', 'n2']);
  });

  it('limits endpoint scope for large container sets', () => {
    const manyContainers = Array.from({ length: 12 }, (_, index) =>
      makeContainer({
        id: `c${index + 1}`,
        name: `app-${index + 1}`,
        state: index % 3 === 0 ? 'stopped' : 'running',
        networks: ['shared'],
      })
    );
    const manyNetworks = [makeNetwork({ id: 'n1', name: 'shared', containers: manyContainers.map((container) => container.id) })];

    const result = buildMetricsNetworkContext({
      containers: manyContainers,
      networks: manyNetworks,
      scope: 'endpoint',
      selectedContainerId: null,
      selectedStack: null,
      knownStackNames: [],
      maxContainers: 5,
    });

    expect(result.containers).toHaveLength(5);
    expect(result.networks).toHaveLength(1);
    expect(result.isTruncated).toBe(true);
  });
});
