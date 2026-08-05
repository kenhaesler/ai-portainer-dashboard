import type { Container } from '@/features/containers/hooks/use-containers';

/**
 * Re-stamps a container with a state **deliberately outside** the contract
 * vocabulary — a Docker-native word (`exited`, `created`, `restarting`) that
 * `normalizeContainer` maps away before any client sees it.
 *
 * `Container.state` is `ContainerState` (`CONTAINER_STATES` in
 * `@dashboard/contracts`), so the compiler refuses these values outright. That
 * refusal is the invariant the fall-through tests guard, not an obstacle to
 * them — the value has to be built on purpose. Widening through a `string`
 * parameter and asserting back is the narrowest way to do it.
 *
 * It lives here, taking the base container rather than building one, because
 * both callers (`container-state-vocabulary.test.ts`, `health-score.test.ts`)
 * have their own `makeContainer` factory with a different signature. Keeping
 * the single `as Container` in one named, imported helper is what stops an
 * ordinary fixture from carrying an out-of-contract state by accident: there is
 * exactly one place in the frontend tests where that cast exists.
 */
export function withNonContractState(base: Container, state: string): Container {
  return { ...base, state } as Container;
}
