import { describe, it, expect } from 'vitest';
import {
  filterTopologyData,
  getContainerStackName,
  matchesContainerSearch,
  matchesNetworkSearch,
  normalizeSearchTerm,
} from './topology-search';
import type { Container } from '@/hooks/use-containers';
import type { Network } from '@/hooks/use-networks';

const makeContainer = (overrides: Partial<Container> & { id: string; name: string }): Container => ({
  id: overrides.id,
  name: overrides.name,
  image: overrides.image ?? 'nginx:latest',
  state: overrides.state ?? 'running',
  status: overrides.status ?? 'Up 5 minutes',
  ports: overrides.ports ?? [],
  created: overrides.created ?? 0,
  networks: overrides.networks ?? [],
  labels: overrides.labels ?? {},
  endpointId: overrides.endpointId ?? 1,
  endpointName: overrides.endpointName ?? 'local',
});

const makeNetwork = (overrides: Partial<Network> & { id: string; name: string }): Network => ({
  id: overrides.id,
  name: overrides.name,
  driver: overrides.driver ?? 'bridge',
  scope: overrides.scope ?? 'local',
  subnet: overrides.subnet ?? '10.0.0.0/24',
  gateway: overrides.gateway ?? '10.0.0.1',
  containers: overrides.containers ?? [],
  endpointId: overrides.endpointId ?? 1,
  endpointName: overrides.endpointName ?? 'local',
});

describe('topology search helpers', () => {
  it('normalizes the search term', () => {
    expect(normalizeSearchTerm('  Stack-A ')).toBe('stack-a');
  });

  it('returns a fallback stack name for containers without compose label', () => {
    const container = makeContainer({ id: 'c1', name: 'api', labels: {} });
    expect(getContainerStackName(container)).toBe('Standalone');
  });

  it('matches containers by name, image, or stack', () => {
    const container = makeContainer({
      id: 'c1',
      name: 'auth-service',
      image: 'registry/auth:1.0',
      labels: { 'com.docker.compose.project': 'security' },
    });

    expect(matchesContainerSearch(container, 'auth')).toBe(true);
    expect(matchesContainerSearch(container, 'registry/auth')).toBe(true);
    expect(matchesContainerSearch(container, 'security')).toBe(true);
    expect(matchesContainerSearch(container, 'billing')).toBe(false);
  });

  it('matches networks by name only', () => {
    const network = makeNetwork({ id: 'n1', name: 'frontend-net' });
    expect(matchesNetworkSearch(network, 'frontend')).toBe(true);
    expect(matchesNetworkSearch(network, 'backend')).toBe(false);
  });

  it('filters to matched containers and linked networks', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'api', labels: { 'com.docker.compose.project': 'stack-a' } }),
      makeContainer({ id: 'c2', name: 'db', labels: { 'com.docker.compose.project': 'stack-b' } }),
    ];
    const networks = [
      makeNetwork({ id: 'n1', name: 'stack-a-net', containers: ['c1'] }),
      makeNetwork({ id: 'n2', name: 'stack-b-net', containers: ['c2'] }),
    ];

    const result = filterTopologyData(containers, networks, 'stack-a');

    expect(result.containers.map(container => container.id)).toEqual(['c1']);
    expect(result.networks.map(network => network.id)).toEqual(['n1']);
  });

  it('includes containers connected to matched networks', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'api', labels: { 'com.docker.compose.project': 'alpha' } }),
      makeContainer({ id: 'c2', name: 'worker', labels: { 'com.docker.compose.project': 'beta' } }),
    ];
    const networks = [
      makeNetwork({ id: 'n1', name: 'shared-net', containers: ['c1', 'c2'] }),
    ];

    const result = filterTopologyData(containers, networks, 'shared-net');

    expect(result.containers.map(container => container.id).sort()).toEqual(['c1', 'c2']);
    expect(result.networks.map(network => network.id)).toEqual(['n1']);
  });
});
