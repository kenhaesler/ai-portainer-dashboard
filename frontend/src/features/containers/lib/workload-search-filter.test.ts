import { describe, expect, it } from 'vitest';
import { parseSearchQuery, filterContainers } from './workload-search-filter';
import type { Container } from '@/features/containers/hooks/use-containers';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'my-service-1',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 hours',
    endpointId: 1,
    endpointName: 'local',
    ports: [{ private: 80, public: 8080, type: 'tcp' }],
    created: 1700000000,
    labels: { 'com.docker.compose.project': 'myapp', env: 'production' },
    networks: [],
    ...overrides,
  };
}

describe('parseSearchQuery', () => {
  it('returns empty array for empty string', () => {
    expect(parseSearchQuery('')).toEqual([]);
    expect(parseSearchQuery('   ')).toEqual([]);
  });

  it('returns free text token', () => {
    expect(parseSearchQuery('nginx')).toEqual([{ value: 'nginx' }]);
  });

  it('parses field:value token', () => {
    expect(parseSearchQuery('state:running')).toEqual([{ field: 'state', value: 'running' }]);
  });

  it('parses multiple tokens', () => {
    expect(parseSearchQuery('state:running image:nginx')).toEqual([
      { field: 'state', value: 'running' },
      { field: 'image', value: 'nginx' },
    ]);
  });

  it('treats unknown field prefix as free text', () => {
    expect(parseSearchQuery('foo:bar')).toEqual([{ value: 'foo:bar' }]);
  });

  it('treats field: with no value as free text', () => {
    expect(parseSearchQuery('state:')).toEqual([{ value: 'state:' }]);
  });

  it('is case-insensitive for field names', () => {
    expect(parseSearchQuery('STATE:running')).toEqual([{ field: 'state', value: 'running' }]);
  });
});

describe('filterContainers', () => {
  const containers = [
    makeContainer({ id: 'c1', name: 'nginx-proxy-1', image: 'nginx:1.25', state: 'running', status: 'Up 1 hour', endpointName: 'prod', labels: { 'com.docker.compose.project': 'proxy', app: 'nginx' } }),
    makeContainer({ id: 'c2', name: 'postgres-db-1', image: 'postgres:15', state: 'running', status: 'Up 2 hours', endpointName: 'prod', labels: { 'com.docker.compose.project': 'db' } }),
    makeContainer({ id: 'c3', name: 'redis-cache-1', image: 'redis:alpine', state: 'exited', status: 'Exited (0)', endpointName: 'staging', labels: {}, ports: [{ private: 6379, public: 6379, type: 'tcp' }] }),
    makeContainer({ id: 'c4', name: 'traefik-proxy-1', image: 'traefik:v3', state: 'running', status: 'Up 3 days', endpointName: 'staging', labels: { 'com.docker.compose.project': 'traefik' } }),
  ];
  const knownStackNames = ['proxy', 'db', 'traefik'];

  it('returns all containers for empty query', () => {
    expect(filterContainers(containers, '', knownStackNames)).toHaveLength(4);
  });

  it('free text matches by name', () => {
    const result = filterContainers(containers, 'nginx', knownStackNames);
    expect(result.map((c) => c.id)).toContain('c1');
    expect(result.map((c) => c.id)).not.toContain('c2');
  });

  it('free text matches by image', () => {
    const result = filterContainers(containers, 'postgres', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c2']);
  });

  it('free text matches by state', () => {
    const result = filterContainers(containers, 'exited', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c3']);
  });

  it('free text matches by status', () => {
    const result = filterContainers(containers, 'Exited (0)', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c3']);
  });

  it('free text matches by endpoint', () => {
    const result = filterContainers(containers, 'staging', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  it('free text matches by label value', () => {
    const result = filterContainers(containers, 'nginx', knownStackNames);
    // c1 has label app:nginx — also matches by name, but coverage is the point
    expect(result.map((c) => c.id)).toContain('c1');
  });

  it('free text matches by port', () => {
    const result = filterContainers(containers, '6379', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c3']);
  });

  it('state:running only matches running containers', () => {
    const result = filterContainers(containers, 'state:running', knownStackNames);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).not.toContain('c3');
  });

  it('state:exited only matches exited containers', () => {
    const result = filterContainers(containers, 'state:exited', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c3']);
  });

  it('image:nginx only matches nginx images', () => {
    const result = filterContainers(containers, 'image:nginx', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('endpoint:prod only matches prod endpoint', () => {
    const result = filterContainers(containers, 'endpoint:prod', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('stack:traefik uses resolveContainerStackName', () => {
    const result = filterContainers(containers, 'stack:traefik', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c4']);
  });

  it('stack:proxy matches compose project label', () => {
    const result = filterContainers(containers, 'stack:proxy', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('port:6379 matches public/private port', () => {
    const result = filterContainers(containers, 'port:6379', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c3']);
  });

  it('label:nginx matches label values', () => {
    const result = filterContainers(containers, 'label:nginx', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('multiple tokens are ANDed', () => {
    const result = filterContainers(containers, 'state:running image:nginx', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('multiple tokens AND with no match returns empty', () => {
    const result = filterContainers(containers, 'state:exited image:nginx', knownStackNames);
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const result = filterContainers(containers, 'STATE:RUNNING', knownStackNames);
    expect(result).toHaveLength(3);
  });

  it('partial match on free text', () => {
    const result = filterContainers(containers, 'post', knownStackNames);
    expect(result.map((c) => c.id)).toEqual(['c2']);
  });
});
