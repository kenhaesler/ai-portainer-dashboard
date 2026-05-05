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

  // -------------------------------------------------------------------------
  // #1025 regression — running containers without a healthcheck must be
  // counted as `unknown`, never as `healthy`. The pre-fix code path had:
  //   else if (container.state === 'running') stats.healthy++;
  // which inflated the healthy count and overall health percentage.
  // These tests pin the corrected behaviour.
  // -------------------------------------------------------------------------

  it('regression #1025: a running container with no healthStatus must NOT be counted as healthy', () => {
    const containers = [
      makeContainer({ state: 'running', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);

    // The bug: running + no healthcheck used to increment stats.healthy.
    // The fix: it must increment stats.unknown instead.
    expect(stats.healthy).toBe(0);
    expect(stats.unknown).toBe(1);
    expect(stats.running).toBe(1);
  });

  it('regression #1025: running containers with non-healthy/non-unhealthy healthStatus values fall through to unknown, not healthy', () => {
    // Docker can report intermediate values like "starting" or "none" that
    // are neither "healthy" nor "unhealthy". The fix must not treat these
    // as healthy via the `state === 'running'` fallback.
    const containers = [
      makeContainer({ id: 'a', state: 'running', healthStatus: 'starting' }),
      makeContainer({ id: 'b', state: 'running', healthStatus: 'none' }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.healthy).toBe(0);
    expect(stats.unhealthy).toBe(0);
    expect(stats.unknown).toBe(2);
    expect(stats.running).toBe(2);
  });

  it('regression #1025: a fleet of only running-no-healthcheck containers must report 0% healthy', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: undefined }),
      makeContainer({ id: '2', state: 'running', healthStatus: undefined }),
      makeContainer({ id: '3', state: 'running', healthStatus: undefined }),
      makeContainer({ id: '4', state: 'running', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);
    const healthPercentage = stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0;

    // Pre-fix: this returned 100% (all running counted as healthy).
    // Post-fix: must be 0% — none have an explicit healthy status.
    expect(stats.healthy).toBe(0);
    expect(stats.unknown).toBe(4);
    expect(healthPercentage).toBe(0);
  });

  it('regression #1025: running, paused, and exited containers without healthStatus all flow to unknown (not healthy)', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: undefined }),
      makeContainer({ id: '2', state: 'paused', healthStatus: undefined }),
      makeContainer({ id: '3', state: 'exited', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.healthy).toBe(0);
    expect(stats.unhealthy).toBe(0);
    expect(stats.unknown).toBe(3);
    expect(stats.running).toBe(1);
    expect(stats.paused).toBe(1);
    expect(stats.stopped).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Percentage calculation — acceptance criterion: verify percentage math
  // for a mixed fleet. The component computes:
  //   healthPercentage = stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0
  // Tests pin the expected health percentage so that future refactors of
  // either the stats logic or the percentage formula stay in sync.
  // -------------------------------------------------------------------------

  it('mixed fleet: derives a 50% health percentage from 2 healthy out of 4 total', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '2', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '3', state: 'running', healthStatus: 'unhealthy' }),
      makeContainer({ id: '4', state: 'exited', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);
    const healthPercentage = stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0;

    expect(stats.total).toBe(4);
    expect(stats.healthy).toBe(2);
    expect(healthPercentage).toBe(50);
  });

  it('mixed fleet: derives ~33.3% health percentage from 1 healthy out of 3 total', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '2', state: 'running', healthStatus: 'unhealthy' }),
      makeContainer({ id: '3', state: 'running', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);
    const healthPercentage = stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0;

    expect(stats.healthy).toBe(1);
    expect(stats.unhealthy).toBe(1);
    expect(stats.unknown).toBe(1);
    expect(healthPercentage).toBeCloseTo(33.333, 2);
  });

  it('empty fleet: percentage formula evaluates to 0 (no division-by-zero)', () => {
    const stats = calculateHealthStats([]);
    const healthPercentage = stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0;

    expect(stats.total).toBe(0);
    expect(healthPercentage).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Branch precedence and edge cases — healthStatus takes priority over the
  // state-based fallback when explicitly set, and the function should be
  // pure (no input mutation, deterministic across calls).
  // -------------------------------------------------------------------------

  it('healthStatus takes precedence over state: an exited container with healthStatus="healthy" still counts as healthy', () => {
    // Defensive branch: if a non-running container somehow carries an
    // explicit healthy/unhealthy status (e.g. last-known status surfaced by
    // the API), the explicit value wins over the state-based fallback.
    const containers = [
      makeContainer({ state: 'exited', healthStatus: 'healthy' }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.healthy).toBe(1);
    expect(stats.stopped).toBe(1);
    expect(stats.unknown).toBe(0);
  });

  it('healthStatus takes precedence over state: an exited container with healthStatus="unhealthy" counts as unhealthy', () => {
    const containers = [
      makeContainer({ state: 'exited', healthStatus: 'unhealthy' }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.unhealthy).toBe(1);
    expect(stats.stopped).toBe(1);
    expect(stats.unknown).toBe(0);
  });

  it('unrecognised state values flow through to unknown without affecting other counters', () => {
    // Docker exposes additional states (created, restarting, removing, dead).
    // None of these match running/exited/paused; with no healthStatus they
    // should still be counted as unknown via the final `else` branch.
    const containers = [
      makeContainer({ id: '1', state: 'created', healthStatus: undefined }),
      makeContainer({ id: '2', state: 'restarting', healthStatus: undefined }),
      makeContainer({ id: '3', state: 'dead', healthStatus: undefined }),
    ];

    const stats = calculateHealthStats(containers);

    expect(stats.total).toBe(3);
    expect(stats.running).toBe(0);
    expect(stats.stopped).toBe(0);
    expect(stats.paused).toBe(0);
    expect(stats.healthy).toBe(0);
    expect(stats.unhealthy).toBe(0);
    expect(stats.unknown).toBe(3);
  });

  it('does not mutate the input containers array', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '2', state: 'running', healthStatus: undefined }),
    ];
    const snapshot = JSON.parse(JSON.stringify(containers));

    calculateHealthStats(containers);

    expect(containers).toEqual(snapshot);
  });

  it('is deterministic: repeated calls with the same input return equivalent stats', () => {
    const containers = [
      makeContainer({ id: '1', state: 'running', healthStatus: 'healthy' }),
      makeContainer({ id: '2', state: 'exited', healthStatus: undefined }),
      makeContainer({ id: '3', state: 'running', healthStatus: 'unhealthy' }),
    ];

    const first = calculateHealthStats(containers);
    const second = calculateHealthStats(containers);

    expect(first).toEqual(second);
  });
});
