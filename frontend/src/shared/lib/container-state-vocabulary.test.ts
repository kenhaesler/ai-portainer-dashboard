import { describe, it, expect } from 'vitest';
import type { ContainerState } from '@dashboard/contracts';
import type { Container } from '@/features/containers/hooks/use-containers';
import { calculateHealthStats, calculateNeedsAttention } from './health-score';

/**
 * Guards the container-state vocabulary against the drift that produced #1610.
 *
 * `calculateHealthStats` compared against `'exited'`. That is Docker's word;
 * `normalizeContainer` maps it to `'stopped'` before any client sees it, so the
 * branch was unreachable and the fleet-health tile reported "0 stopped" —
 * "No unhealthy or stopped containers", under a green check — while containers
 * were genuinely down. The live API said `stopped: 6` at the time it was found.
 *
 * The reason it survived is the interesting part, and it is what this file
 * exists to prevent: the tile's own test suite built every fixture with
 * `state: 'exited'`, so the tests agreed with the bug. A suite that invents its
 * own vocabulary cannot catch a vocabulary error. Both halves below are needed:
 *
 *  1. `HANDLED_STATES` is typed `Record<ContainerState, ...>`, so adding a state
 *     to `CONTAINER_STATES` in `@dashboard/contracts` and not deciding what it
 *     means here is a *compile* error, caught by `npm run typecheck`.
 *  2. The runtime cases below assert each state actually lands in the bucket it
 *     claims, driven from that same map rather than from hand-written literals.
 */

/** Which `HealthStats` bucket each contract state must increment. */
const HANDLED_STATES: Record<ContainerState, keyof ReturnType<typeof calculateHealthStats> | null> = {
  running: 'running',
  stopped: 'stopped',
  paused: 'paused',
  dead: 'dead',
  // `unknown` is deliberately uncounted in the state buckets: it means Docker
  // reported something we do not recognise, which is not a claim that the
  // container is up or down. It still reaches `stats.unknown` via healthStatus.
  unknown: null,
};

/** States that must contribute to the "needs attention" hero number. */
const ATTENTION_STATES: ContainerState[] = ['stopped', 'dead'];

function makeContainer(state: ContainerState): Container {
  return {
    id: `id-${state}`,
    name: `container-${state}`,
    image: 'nginx:latest',
    state,
    status: 'Exited (143) 2 minutes ago',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: Date.now(),
    labels: {},
    networks: ['bridge'],
  };
}

describe('container state vocabulary', () => {
  it('never counts Docker\'s raw "exited" — the normalizer maps it to "stopped"', () => {
    // The exact regression. `'exited'` is not in the contract vocabulary, so it
    // must fall through to no state bucket at all rather than silently counting.
    const stats = calculateHealthStats([{ ...makeContainer('stopped'), state: 'exited' } as Container]);

    expect(stats.stopped).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.total).toBe(1);
  });

  it('counts a container in the contract\'s "stopped" state as stopped', () => {
    const stats = calculateHealthStats([makeContainer('stopped')]);

    expect(stats.stopped).toBe(1);
  });

  for (const [state, bucket] of Object.entries(HANDLED_STATES) as [
    ContainerState,
    keyof ReturnType<typeof calculateHealthStats> | null,
  ][]) {
    it(`routes contract state "${state}" to ${bucket ?? 'no state bucket'}`, () => {
      const stats = calculateHealthStats([makeContainer(state)]);

      for (const candidate of ['running', 'stopped', 'paused', 'dead'] as const) {
        expect(stats[candidate]).toBe(candidate === bucket ? 1 : 0);
      }
    });
  }

  for (const state of ATTENTION_STATES) {
    it(`counts a "${state}" container as needing attention`, () => {
      const stats = calculateHealthStats([makeContainer(state)]);

      expect(calculateNeedsAttention(stats).containers).toBe(1);
    });
  }

  it('does not count a running or paused container as needing attention', () => {
    const stats = calculateHealthStats([makeContainer('running'), makeContainer('paused')]);

    expect(calculateNeedsAttention(stats).containers).toBe(0);
  });

  it('agrees with the shape of /api/dashboard/summary.kpis', () => {
    // The dashboard summary endpoint counts `running` and `stopped` over the
    // same normalized containers. The two are rendered ~400px apart on Home, so
    // a disagreement between them is visible to the operator; this pins that
    // the client-side derivation produces the same two numbers for one fleet.
    const fleet = [
      makeContainer('running'),
      makeContainer('running'),
      makeContainer('stopped'),
      makeContainer('stopped'),
      makeContainer('stopped'),
      makeContainer('paused'),
    ];
    const apiKpis = { running: 2, stopped: 3, total: 6 };

    const stats = calculateHealthStats(fleet);

    expect({ running: stats.running, stopped: stats.stopped, total: stats.total }).toEqual(apiKpis);
  });
});
