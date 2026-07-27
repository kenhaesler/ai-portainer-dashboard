import type { ContainerState } from '@dashboard/contracts';

/**
 * Predicates over the container-state vocabulary.
 *
 * These exist because the comparison was hand-rolled at five call sites and
 * four of them tested for `'exited'` — Docker's word, which the server-side
 * normalizer maps to `'stopped'` before any client sees it. Every one of those
 * branches was unreachable: the fleet tile reported "0 stopped" with containers
 * down, the comparison view rendered a stopped container in neutral grey, and
 * the correlated-anomaly filter skipped stopped containers entirely.
 *
 * Import these rather than comparing state literals inline. The parameter is
 * typed `ContainerState`, so a typo or a Docker-native word is a compile error
 * rather than a branch that silently never runs.
 */

/**
 * A container that is not doing its job: cleanly stopped, or `dead` (a failed
 * removal). Both belong in "needs attention"; neither is a state an operator
 * has necessarily seen.
 */
export function isDownState(state: ContainerState): boolean {
  return state === 'stopped' || state === 'dead';
}

/** Semantic tone for status pills, dots, and comparison cells. */
export type ContainerStateTone = 'running' | 'down' | 'neutral';

export function containerStateTone(state: ContainerState): ContainerStateTone {
  if (state === 'running') return 'running';
  if (isDownState(state)) return 'down';
  // `paused` and `unknown` are deliberately neutral: paused is a deliberate
  // operator action, and unknown is an absence of information, not a fault.
  return 'neutral';
}
