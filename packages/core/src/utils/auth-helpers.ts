/**
 * Auth helpers — typed accessors for `request.user`.
 *
 * The `FastifyRequest['user']` type is declared as optional (see
 * `packages/core/src/plugins/auth.ts`) because not every request carries an
 * authenticated user. Routes guarded by the `authenticate` preHandler are
 * guaranteed to have `request.user` populated at runtime, but TypeScript has
 * no way to express that a preHandler has already run by the time the
 * handler body executes — so handlers historically used the non-null
 * assertion (`request.user!.sub`) to satisfy the compiler.
 *
 * That assertion is brittle: if a future refactor removes or reorders the
 * preHandler chain, the `!` silently masks the bug and the handler will
 * crash on `undefined.sub` or, worse, write `undefined` to an audit log.
 *
 * `assertUser` replaces the assertion with a defensive runtime check that
 * throws a loud error if the preHandler chain is misconfigured. The throw
 * is unreachable under correct configuration; its purpose is to fail
 * loudly during development rather than silently bypass admin auth.
 *
 * See issue #1110.
 */

import type { FastifyRequest } from 'fastify';

/**
 * The user shape attached to authenticated requests. Mirrors the
 * augmentation in `packages/core/src/plugins/auth.ts`.
 */
export type AuthenticatedUser = NonNullable<FastifyRequest['user']>;

/**
 * Narrow `request.user` from `T | undefined` to `T`.
 *
 * Throws if called on a request that has not been through the
 * `fastify.authenticate` preHandler. Under correct configuration this
 * branch is unreachable; the throw exists so that future refactors that
 * accidentally remove the preHandler fail loudly rather than silently
 * bypassing admin authentication.
 *
 * @param request - the Fastify request to read `user` from.
 * @returns the authenticated user, narrowed to non-null.
 * @throws Error if `request.user` is undefined.
 */
export function assertUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    // Defensive: only reachable if the `authenticate` preHandler is missing
    // or misconfigured. Loud failure beats silent admin auth bypass.
    throw new Error('assertUser called without authenticate preHandler');
  }
  return request.user;
}
