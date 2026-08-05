import type { Endpoint } from '@/features/containers/hooks/use-endpoints';

/**
 * Which `snapshotSource` an endpoint of this shape really carries.
 *
 * Mirrors `endpointSupportsLiveDockerInfo` in
 * `packages/core/src/portainer/portainer-normalizers.ts` exactly — live
 * `/docker/info` enrichment is attempted for endpoints that are up AND Docker
 * (`DOCKER_ENDPOINT_TYPES` = 1/2/4), and for nothing else. Kubernetes and Edge
 * Async are types 5/6/7, so the type check already excludes them, and a down
 * endpoint is never queried; all of those keep the `'unavailable'` the
 * normalizer starts every endpoint at.
 *
 * `edgeMode` is deliberately NOT consulted, even though it reads like it
 * should: production decides on `status` and `type` alone, and an earlier
 * version of this helper that also required `edgeMode !== 'async'` was
 * STRICTER than the code it stands in for — a fixture with `type: 4` (Edge
 * Docker) in async mode would have been handed `'unavailable'` for counts
 * production would really have fetched. A fixture that wants an endpoint with
 * no live counts should say so through `type`/`status`, or pass
 * `snapshotSource` explicitly; the factories honour an explicit override.
 *
 * `snapshotSource` became required on `Endpoint` while nothing typechecked the
 * frontend tests (#1617), so four `makeEndpoint` factories had drifted into
 * omitting it. Deriving it here, rather than defaulting each factory to
 * `'live'`, means a fixture that overrides `status`/`type` cannot end up
 * claiming live counts it could never have had — and the Docker type set lives
 * in ONE place, so the next Portainer endpoint type does not have to be
 * remembered in four.
 *
 * It is a derivation, not a compile-time-checked copy: the frontend may not
 * import `@dashboard/core` (enforced by `frontend/eslint.config.js`, #1587),
 * so a drift here surfaces as a fixture that disagrees with the API payloads
 * the hook tests assert against, not as a type error.
 */
export function snapshotSourceFor(
  ep: Pick<Endpoint, 'status' | 'type'>,
): Endpoint['snapshotSource'] {
  const isDockerType = ep.type === 1 || ep.type === 2 || ep.type === 4;
  return ep.status === 'up' && isDockerType ? 'live' : 'unavailable';
}
