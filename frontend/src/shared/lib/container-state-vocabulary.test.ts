import { describe, it, expect } from 'vitest';
import { CONTAINER_STATES, type ContainerState } from '@dashboard/contracts';
import type { Container } from '@/features/containers/hooks/use-containers';
import { calculateHealthStats, calculateNeedsAttention } from './health-score';

/**
 * Guards the container-state vocabulary that `calculateHealthStats` compares
 * against. It once compared against `'exited'` — Docker's word, which
 * `normalizeContainer` maps to `'stopped'` before any client sees it, so the
 * branch was unreachable and `stats.stopped` stayed 0 (commit b9152cda).
 * `health-score.test.ts` used `state: 'exited'` for its stopped-container
 * fixtures, so those cases agreed with the bug; hence this file, driven from
 * the contract instead.
 *
 * Completeness is checked at runtime, not by the compiler. `HANDLED_STATES` is
 * typed `Record<ContainerState, ...>`, but `frontend/tsconfig.json` excludes
 * `src/**\/*.test.ts` from the program, so `npm run typecheck` never reads this
 * file and the missing key would not be a compile error. The first case below
 * compares the map's keys against `CONTAINER_STATES` directly, which vitest
 * does run.
 *
 * The wording the tile uses for the zero case is owned and asserted by
 * `health-score-card.tsx` / `health-score-card.test.tsx`; it is not repeated
 * here.
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
  it('decides a bucket for every state in the contract', () => {
    // The completeness half of this file's contract, as a runtime assertion
    // because nothing typechecks it: adding a state to `CONTAINER_STATES` and
    // not deciding what it means here fails right here.
    expect(Object.keys(HANDLED_STATES).sort()).toEqual([...CONTAINER_STATES].sort());
  });

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

  it('derives running, stopped and total for a mixed fleet', () => {
    const fleet = [
      makeContainer('running'),
      makeContainer('running'),
      makeContainer('stopped'),
      makeContainer('stopped'),
      makeContainer('stopped'),
      makeContainer('paused'),
    ];
    const stats = calculateHealthStats(fleet);

    expect({ running: stats.running, stopped: stats.stopped, total: stats.total }).toEqual({
      running: 2,
      stopped: 3,
      total: 6,
    });
  });
});
