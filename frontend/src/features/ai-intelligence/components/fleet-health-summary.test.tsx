import { describe, it, expect } from 'vitest';
import type { Container } from '@/features/containers/hooks/use-containers';
import { calculateHealthStats } from './fleet-health-summary';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'test-id',
    name: 'test-container',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 hours',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: Date.now(),
    labels: {},
    networks: ['bridge'],
    ...overrides,
  };
}

describe('calculateHealthStats', () => {
  it('should return all zeros for an empty array', () => {
    const stats = calculateHealthStats([]);

    expect(stats).toEqual({
      total: 0,
      running: 0,
      stopped: 0,
      paused: 0,
      unhealthy: 0,
      healthy: 0,
      unknown: 0,
    });
  });

  it('should count containers with healthStatus "healthy" as healthy', () => {
    const containers = [
      makeContainer({ state: 'running', healthStatus: 'healthy' }),
      makeContainer({ state: 'running', healthStatus: 'healthy' }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.healthy).toBe(2);
    expect(stats.running).toBe(2);
    expect(stats.unknown).toBe(0);
  });

  it('should count containers with healthStatus "unhealthy" as unhealthy', () => {
    const containers = [
      makeContainer({ state: 'running', healthStatus: 'unhealthy' }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.unhealthy).toBe(1);
    expect(stats.healthy).toBe(0);
    expect(stats.running).toBe(1);
  });

  it('should count running containers without a healthcheck as unknown, not healthy', () => {
    const containers = [
      makeContainer({ state: 'running', healthStatus: undefined }),
      makeContainer({ state: 'running' }), // no healthStatus field
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.unknown).toBe(2);
    expect(stats.healthy).toBe(0);
    expect(stats.running).toBe(2);
  });

  it('should count stopped containers as stopped and unknown', () => {
    const containers = [
      makeContainer({ state: 'exited', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.stopped).toBe(1);
    expect(stats.unknown).toBe(1);
    expect(stats.running).toBe(0);
  });

  it('should count paused containers', () => {
    const containers = [
      makeContainer({ state: 'paused', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.paused).toBe(1);
    expect(stats.unknown).toBe(1);
  });

  it('should calculate correct totals for a mixed fleet', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '2', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '3', state: 'running', healthStatus: 'unhealthy' }),
      makeContainer({ id: '4', state: 'running', healthStatus: undefined }),
      makeContainer({ id: '5', state: 'exited', healthStatus: undefined }),
      makeContainer({ id: '6', state: 'paused', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.total).toBe(6);
    expect(stats.running).toBe(4);
    expect(stats.stopped).toBe(1);
    expect(stats.paused).toBe(1);
    expect(stats.healthy).toBe(2);
    expect(stats.unhealthy).toBe(1);
    expect(stats.unknown).toBe(3);
  });

  it('should set total to the length of the containers array', () => {
    const containers = [
      makeContainer({ id: '1' }),
      makeContainer({ id: '2' }),
      makeContainer({ id: '3' }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.total).toBe(3);
  });
});
