# Portainer 2.45.0 compatibility investigation

## Evidence and scope

Compared upstream CE tags `2.39.0`, `2.44.0`, and `2.45.0` (commit
`d79ba726cd54395a54cca5e9180609ce52fa7a4f`). The previous deployed version and
the failing deployment's responses were not available during local investigation.
These fixes reproduce concrete contract failures, not a confirmed diagnosis of
the user's running server. BE-specific behaviour still needs live validation.

## Upstream API changes affecting this client

| Area | Finding | Dashboard handling |
| --- | --- | --- |
| Docker proxy | 2.45 tightens authorization of version prefixes and encoded path separators. Existing unversioned read URLs remain valid. | Keep canonical routes and normal API-key authentication; never bypass upstream authorization. |
| Endpoints | Between 2.39 and 2.45, `Status` became `omitempty`; zero is absent. Empty snapshot/tag arrays can be omitted; older responses can contain null collections. | Accept absent status as zero, not up; normalize null collections. One such endpoint no longer invalidates the entire endpoint list. |
| Snapshot payloads | `DockerSnapshotRaw.Containers` and `.Images` are arrays, not numeric counts. These are unused by the live fleet pipeline. | Accept the actual shape (and legacy numeric fixtures), and request snapshot exclusion. List uses plural `excludeSnapshots`, inspect singular `excludeSnapshot`. Both flags exist in 2.39 too. |
| Stack lifecycle | Status 3 means deploying; 4 means deployment error. List/inspect retain the existing top-level stack shape. Git source/workflow fields are additive for this observer client. | Preserve active/inactive/deploying/error/unknown through the shared contract, normalization, badges, counts and filters. |
| Kubernetes | New native write APIs; stricter namespace authorization and 403 responses on denials. | Existing Kubernetes read proxy routes need no URL migration. Upstream permission denials must remain denials. No new write actions added. |

Sources:
- [2.45.0 release notes](https://github.com/portainer/portainer/releases/tag/2.45.0)
- [Endpoint and stack wire types/constants](https://github.com/portainer/portainer/blob/2.45.0/api/portainer.go)
- [Endpoint list handler](https://github.com/portainer/portainer/blob/2.45.0/api/http/handler/endpoints/endpoint_list.go)
- [Endpoint inspect handler](https://github.com/portainer/portainer/blob/2.45.0/api/http/handler/endpoints/endpoint_inspect.go)
- [Docker proxy dispatch](https://github.com/portainer/portainer/blob/2.45.0/api/http/proxy/factory/docker/transport.go)
- [Stack response compatibility](https://github.com/portainer/portainer/blob/2.45.0/api/http/handler/stacks/response.go)

## Additional integration bugs fixed

- Live fleet `/docker/info` calls previously bypassed the Portainer dispatcher.
  Consequently a self-signed/custom-CA server could work for container reads but
  fail for all fleet counts. Both now use the same pool and explicit TLS settings;
  verification stays enabled by default.
- Docker's nullable collections could reject otherwise valid container lists
  (`Labels`, `Mounts`) and dangling-image lists (`RepoTags`). Normalize only these
  known nullable collections; malformed identity/type values still fail validation.
- Container inspect accepted `HostConfig.CapAdd: null` but failed when converting
  back into the list contract. Null capabilities now normalize to an empty list.

These are pre-existing client defects exposed by valid responses/configuration;
they are not all newly introduced upstream in 2.45.

## Validation

- New compatibility tests first reproduced six failures before implementation.
- Contracts: 32 tests pass. Core Portainer and model suites: 296 tests pass.
- HTTP 401/403 regressions verify that the client preserves permission denials,
  makes no alternative-path retries, and does not trip other environments' breakers.
- Targeted frontend fleet/search/status/hook suites: 144 tests pass.
- Production frontend exercised in Chromium at 1440px and 390px with HTTP-boundary
  fixtures: all five lifecycle statuses render; selecting Error shows only the
  matching stack. This is a UI smoke check, not a live Portainer test.
- Full repository `npm run typecheck`: passes.
- Full production build: passes using Git Bash as npm's script shell on Windows.
- Backend, frontend, and package ESLint: pass. On Windows the package command
  needs double-quoted globs; the root Bash gate currently fails on pre-existing
  CRLF shell scripts. Those unrelated files were not modified.
- Local live smoke passed against `portainer/portainer-ce:2.45.0`, image digest
  `sha256:511f3f06c96fe3b993ebeaafde311c1959cae73a7ef825dba6397d51b450dffa`.
  The production-built client read 1 endpoint, 36 containers, 61 images, 11
  networks, and an empty stacks list. Docker info (32 CPUs), live fleet info,
  container inspect, stats, and logs all passed without mocks. Portainer's data
  was isolated on tmpfs with generated in-memory credentials and a loopback-only
  HTTP listener. Only the temporary Portainer configuration was created; monitored
  containers and persistent volumes were not modified.
- The user's remote deployment, BE/Edge environments, populated stack reads, and
  full PostgreSQL integration still require deployment/CI verification. The user
  approved local smoke testing and subsequent deployment verification themselves.

## Live acceptance checklist

1. Confirm previous version, CE/BE edition, exact error, and whether Portainer's
   own UI can list the affected environments/containers.
2. From the dashboard runtime, verify the configured server base URL (without
   `/api`) and TLS trust. Keep API keys out of logs and issue comments.
3. With the configured key, read `/api/endpoints?excludeSnapshots=true`, a reachable
   endpoint's `/docker/info`, `/docker/containers/json?all=true`, container inspect,
   stats/logs, networks/images, and `/api/stacks`. Check HTTP status before schema.
   A successful public `/api/status` alone does not prove API-key permissions.
4. A 401/403 requires correcting the upstream account/key/environment permissions;
   the dashboard admin role does not grant Portainer privileges. Do not work around
   2.45's authorization hardening with alternative version/encoded paths.
5. Deploy the patched build through the usual workflow; confirm fleet counts,
   nullable collection responses, inspect, and deploying/error stack filters.
   Edge Async remains intentionally unavailable for live Docker queries.
