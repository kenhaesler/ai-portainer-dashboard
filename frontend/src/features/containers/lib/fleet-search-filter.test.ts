import { describe, expect, it } from 'vitest';
import {
  parseFleetSearchQuery,
  filterEndpoints,
  filterStacks,
  type StackWithEndpoint,
} from './fleet-search-filter';
import type { Endpoint } from '@/features/containers/hooks/use-endpoints';

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 1,
    name: 'prod-server-1',
    type: 1,
    url: 'tcp://192.168.1.10:2376',
    status: 'up',
    containersRunning: 5,
    containersStopped: 1,
    containersHealthy: 4,
    containersUnhealthy: 0,
    totalContainers: 6,
    stackCount: 3,
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

function makeStack(overrides: Partial<StackWithEndpoint> = {}): StackWithEndpoint {
  return {
    id: 1,
    name: 'traefik',
    type: 2,
    endpointId: 1,
    status: 'active',
    endpointName: 'prod-server-1',
    envCount: 3,
    containerCount: 2,
    ...overrides,
  };
}

describe('parseFleetSearchQuery', () => {
  it('returns empty array for empty string', () => {
    expect(parseFleetSearchQuery('')).toEqual([]);
    expect(parseFleetSearchQuery('   ')).toEqual([]);
  });

  it('returns free text token', () => {
    expect(parseFleetSearchQuery('prod')).toEqual([{ value: 'prod' }]);
  });

  it('parses field:value token', () => {
    expect(parseFleetSearchQuery('name:prod')).toEqual([{ field: 'name', value: 'prod' }]);
  });

  it('parses status field', () => {
    expect(parseFleetSearchQuery('status:up')).toEqual([{ field: 'status', value: 'up' }]);
  });

  it('parses url field', () => {
    expect(parseFleetSearchQuery('url:192.168')).toEqual([{ field: 'url', value: '192.168' }]);
  });

  it('parses type field', () => {
    expect(parseFleetSearchQuery('type:edge')).toEqual([{ field: 'type', value: 'edge' }]);
  });

  it('parses endpoint field (for stacks)', () => {
    expect(parseFleetSearchQuery('endpoint:prod')).toEqual([{ field: 'endpoint', value: 'prod' }]);
  });

  it('parses multiple tokens', () => {
    expect(parseFleetSearchQuery('status:up name:prod')).toEqual([
      { field: 'status', value: 'up' },
      { field: 'name', value: 'prod' },
    ]);
  });

  it('treats unknown field prefix as free text', () => {
    expect(parseFleetSearchQuery('foo:bar')).toEqual([{ value: 'foo:bar' }]);
  });

  it('treats field: with no value as free text', () => {
    expect(parseFleetSearchQuery('name:')).toEqual([{ value: 'name:' }]);
  });

  it('is case-insensitive for field names', () => {
    expect(parseFleetSearchQuery('NAME:prod')).toEqual([{ field: 'name', value: 'prod' }]);
  });
});

describe('filterEndpoints', () => {
  const endpoints = [
    makeEndpoint({ id: 1, name: 'prod-server-1', url: 'tcp://10.0.0.1:2376', status: 'up', type: 1 }),
    makeEndpoint({ id: 2, name: 'staging-server', url: 'tcp://10.0.0.2:2376', status: 'up', type: 4, isEdge: true }),
    makeEndpoint({ id: 3, name: 'dev-local', url: 'tcp://localhost:2375', status: 'down', type: 2 }),
    makeEndpoint({ id: 4, name: 'prod-k8s', url: 'https://k8s.example.com', status: 'up', type: 5 }),
  ];

  it('returns all endpoints for empty query', () => {
    expect(filterEndpoints(endpoints, '')).toHaveLength(4);
  });

  it('free text matches by name', () => {
    const result = filterEndpoints(endpoints, 'prod');
    expect(result.map(e => e.id)).toEqual([1, 4]);
  });

  it('free text matches by url', () => {
    const result = filterEndpoints(endpoints, 'localhost');
    expect(result.map(e => e.id)).toEqual([3]);
  });

  it('free text matches by status', () => {
    const result = filterEndpoints(endpoints, 'down');
    expect(result.map(e => e.id)).toEqual([3]);
  });

  it('free text matches by type name', () => {
    const result = filterEndpoints(endpoints, 'kubernetes');
    expect(result.map(e => e.id)).toEqual([4]);
  });

  it('name: field matches only name', () => {
    const result = filterEndpoints(endpoints, 'name:staging');
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it('status: field matches only status', () => {
    const result = filterEndpoints(endpoints, 'status:down');
    expect(result.map(e => e.id)).toEqual([3]);
  });

  it('url: field matches only url', () => {
    const result = filterEndpoints(endpoints, 'url:k8s');
    expect(result.map(e => e.id)).toEqual([4]);
  });

  it('type: field matches endpoint type', () => {
    const result = filterEndpoints(endpoints, 'type:edge');
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it('multiple tokens are ANDed', () => {
    const result = filterEndpoints(endpoints, 'status:up name:prod');
    expect(result.map(e => e.id)).toEqual([1, 4]);
  });

  it('multiple tokens AND with no match returns empty', () => {
    const result = filterEndpoints(endpoints, 'status:down name:prod');
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const result = filterEndpoints(endpoints, 'PROD');
    expect(result.map(e => e.id)).toEqual([1, 4]);
  });

  it('ignores non-endpoint fields gracefully', () => {
    const result = filterEndpoints(endpoints, 'endpoint:prod');
    // endpoint: is not an endpoint field, so no match
    expect(result).toHaveLength(0);
  });

  it('partial match works', () => {
    const result = filterEndpoints(endpoints, 'stag');
    expect(result.map(e => e.id)).toEqual([2]);
  });
});

describe('filterStacks', () => {
  const stacks: StackWithEndpoint[] = [
    makeStack({ id: 1, name: 'traefik', status: 'active', endpointName: 'prod-server-1', containerCount: 2 }),
    makeStack({ id: 2, name: 'postgres-db', status: 'active', endpointName: 'prod-server-1', containerCount: 1 }),
    makeStack({ id: 3, name: 'redis-cache', status: 'inactive', endpointName: 'staging-server', containerCount: 3 }),
    makeStack({ id: 4, name: 'monitoring', status: 'active', endpointName: 'dev-local', containerCount: 5 }),
  ];

  it('returns all stacks for empty query', () => {
    expect(filterStacks(stacks, '')).toHaveLength(4);
  });

  it('free text matches by stack name', () => {
    const result = filterStacks(stacks, 'traefik');
    expect(result.map(s => s.id)).toEqual([1]);
  });

  it('free text matches by endpoint name', () => {
    const result = filterStacks(stacks, 'staging');
    expect(result.map(s => s.id)).toEqual([3]);
  });

  it('free text matches by container count', () => {
    const result = filterStacks(stacks, '5');
    expect(result.map(s => s.id)).toEqual([4]);
  });

  it('name: field matches only stack name', () => {
    const result = filterStacks(stacks, 'name:postgres');
    expect(result.map(s => s.id)).toEqual([2]);
  });

  it('status: field matches only status', () => {
    const result = filterStacks(stacks, 'status:inactive');
    expect(result.map(s => s.id)).toEqual([3]);
  });

  it('endpoint: field matches only endpoint name', () => {
    const result = filterStacks(stacks, 'endpoint:prod');
    expect(result.map(s => s.id)).toEqual([1, 2]);
  });

  it('multiple tokens are ANDed', () => {
    const result = filterStacks(stacks, 'status:active endpoint:prod');
    expect(result.map(s => s.id)).toEqual([1, 2]);
  });

  it('multiple tokens AND with no match returns empty', () => {
    const result = filterStacks(stacks, 'status:inactive endpoint:prod');
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    // "inactive" contains "active" so all 4 match substring search
    const result = filterStacks(stacks, 'STATUS:ACTIVE');
    expect(result).toHaveLength(4);
  });

  it('exact status match narrows results', () => {
    const result = filterStacks(stacks, 'status:inact');
    expect(result.map(s => s.id)).toEqual([3]);
  });

  it('ignores non-stack fields gracefully', () => {
    const result = filterStacks(stacks, 'url:something');
    // url: is not a stack field, so no match
    expect(result).toHaveLength(0);
  });

  it('partial match works', () => {
    const result = filterStacks(stacks, 'post');
    expect(result.map(s => s.id)).toEqual([2]);
  });
});
