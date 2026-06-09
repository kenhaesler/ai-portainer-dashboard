# Portainer mock (CI E2E)

A WireMock container that serves canned Portainer API responses so the CI E2E
stack has fleet data without a real Portainer. Used only by
`docker-compose.e2e.yml` (layered over the production compose in the `e2e` CI
job). Not part of any production image.

- `__files/` — JSON response bodies.
- `mappings/` — WireMock request→response stubs (matched by `urlPath` /
  `urlPathPattern`).

The fixtures are validated against the backend's real Zod schemas + normalizers
by `packages/core/src/portainer/portainer-mock-fixtures.test.ts` (runs in the
normal package test job — no Docker needed), so they cannot silently drift from
what the backend parses.

Run locally:

    docker compose -f docker/docker-compose.yml -f docker/docker-compose.e2e.yml up -d portainer-mock
    curl -s localhost:9000/api/endpoints | jq
