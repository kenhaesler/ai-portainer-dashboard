import type { Endpoint } from '@/features/containers/hooks/use-endpoints';

/**
 * Which `snapshotSource` an endpoint of this shape really carries.
 *
 * Live `/docker/info` enrichment is only attempted for endpoints that are up
 * AND Docker (Portainer types 1/2/4) — `endpointSupportsLiveDockerInfo` in
 * `packages/core/src/portainer/portainer-normalizers.ts`. Kubernetes (5/6) and
 * Edge Async (type 7, i.e. `edgeMode: 'async'`) have no Docker tunnel, and a
 * down endpoint is never queried, so those keep the `'unavailable'` the
 * normalizer starts every endpoint at.
 *
 * `snapshotSource` became required on `Endpoint` while nothing typechecked the
 * frontend tests (#1617), so four `makeEndpoint` factories had drifted into
 * omitting it. Deriving it here, rather than defaulting each factory to
 * `'live'`, means a fixture that overrides `status`/`type`/`edgeMode` cannot
 * end up claiming live counts it could never have had — and the Docker type
 * set lives in ONE place, so the next Portainer endpoint type does not have to
 * be remembered in four.
 *
 * It is a derivation, not a copy of the production predicate: the frontend may
 * not import `@dashboard/core` (enforced by `frontend/eslint.config.js`, #1587),
 * so a drift here surfaces as a fixture that disagrees with the API payloads
 * the hook tests assert against, not as a compile error.
 */
export function snapshotSourceFor(
  ep: Pick<Endpoint, 'status' | 'type' | 'edgeMode'>,
): Endpoint['snapshotSource'] {
  const isDockerType = ep.type === 1 || ep.type === 2 || ep.type === 4;
  return ep.status === 'up' && ep.edgeMode !== 'async' && isDockerType ? 'live' : 'unavailable';
}
