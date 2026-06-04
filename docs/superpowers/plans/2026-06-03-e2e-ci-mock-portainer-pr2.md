# CI Mock Portainer (#1420 PR 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the CI E2E stack a populated Portainer (a WireMock service serving canned JSON) so the data-dependent specs — container search/detail and the #1310 dropdown-anchor regression guard — run against real fleet data instead of timing out, turning the nightly E2E green and meaningful. Closes #1420.

**Architecture:** A CI-only compose override (`docker/docker-compose.e2e.yml`) adds a `portainer-mock` WireMock container on `dashboard-net`; the CI job repoints the backend's `PORTAINER_API_URL` at it. Canned response bodies live in `docker/portainer-mock/__files/` and stub mappings in `docker/portainer-mock/mappings/`. A Docker-free vitest **contract test** runs every fixture through the backend's real Zod schemas + normalizers, so the fixtures provably match what the backend parses (and break loudly if a parser changes). The production `docker/docker-compose.yml` is untouched.

**Tech Stack:** WireMock 3 (Docker image), Docker Compose override files, Vitest, the existing `@dashboard/core` Portainer Zod schemas/normalizers, GitHub Actions.

**Branch:** `feature/1420-ci-mock-portainer` (already created off `dev`). Depends conceptually on PR 1 (#1428, shell resilience) — but is mergeable independently; with PR 1 merged, any unmocked path degrades gracefully instead of white-screening.

---

## Background the implementer needs

- The backend reads Portainer over these GET paths (client at `packages/core/src/portainer/portainer-client.ts`, parsed with Zod schemas in `packages/core/src/models/portainer.ts`, normalized in `packages/core/src/portainer/portainer-normalizers.ts`, live counts in `packages/core/src/portainer/edge-live-query.ts`):
  - `GET /api/endpoints` → `EndpointArraySchema.parse` → `normalizeEndpoint`. `Type:1` = Docker local (live-capable), `Status:1` = up. (Edge Async `Type:7` / down ⇒ `unavailable`.)
  - `GET /api/endpoints/{id}` → `EndpointSchema.parse` (single).
  - `GET /api/endpoints/{id}/docker/_ping` → any 2xx = reachable.
  - `GET /api/endpoints/{id}/docker/info` → reads `Containers`, `ContainersRunning`, `ContainersStopped`, `ContainersPaused?`, `NCPU?`, `MemTotal?` (edge-live-query.ts:100-131) → `applyLiveDockerInfo` ⇒ `snapshotSource:'live'`.
  - `GET /api/endpoints/{id}/docker/containers/json` → `ContainerArraySchema.parse` → `normalizeContainer`. `Names:["/x"]` (leading `/` stripped), `State`, `Status` (health parsed from `(healthy)`/`(unhealthy)`), compose labels in `Labels`.
  - `GET /api/endpoints/{id}/docker/containers/{cid}/json` → `ContainerInspectSchema.parse` (Docker inspect shape: `State` object, `Config.Image`, ISO `Created`).
  - `GET /api/stacks` → `z.array(StackSchema).parse` → `normalizeStack`. `EndpointId` links a stack to its endpoint.
  - `GET /api/endpoints/{id}/docker/networks` → `z.array(NetworkSchema)`; `GET /api/endpoints/{id}/docker/images/json` → `z.array(ImageSchema)`.
- **Auth:** client sends header `X-API-Key`. WireMock can ignore it.
- **Circuit breaker:** 2xx keeps it CLOSED; a 4xx (e.g. WireMock's default 404 for an unmapped path) does NOT trip it. So unmocked read paths are benign — they 404, the breaker stays closed, and PR 1's boundary keeps the page graceful. We only mock the paths the E2E-relevant pages need.
- **Compose:** `docker/docker-compose.yml` `backend` service reads `PORTAINER_API_URL=${PORTAINER_API_URL:-...}` / `PORTAINER_API_KEY=${PORTAINER_API_KEY:-}` from env (lines 27-28), is on `dashboard-net` (line 91), and `depends_on` redis/postgres-app/timescaledb (lines 84-90).
- **CI:** the `e2e` job (`.github/workflows/ci.yml`, ~line 279) is opt-in (nightly schedule / `workflow_dispatch` / PR with the `e2e` label). It builds images, starts DBs (phase 1), starts redis+backend+frontend (phase 2), runs `npm run test:e2e`, dumps logs, and `down -v`. It currently sets `PORTAINER_API_URL: http://127.0.0.1:9999` (dead).

---

## File Structure

- **Create** `docker/portainer-mock/__files/` — canned JSON response bodies:
  `endpoints.json`, `endpoint.json`, `docker-info.json`, `containers.json`, `container-inspect.json`, `stacks.json`, `networks.json`, `images.json`.
- **Create** `docker/portainer-mock/mappings/` — WireMock stub mappings (one JSON per path).
- **Create** `docker/portainer-mock/README.md` — what this is, how to run it locally.
- **Create** `packages/core/src/portainer/portainer-mock-fixtures.test.ts` — contract test: parse every fixture with the real schemas + normalizers; assert `live` + counts + shapes; assert mapping integrity (every `bodyFileName` exists; required paths covered).
- **Create** `docker/docker-compose.e2e.yml` — CI-only override: `portainer-mock` service + `backend.depends_on` + published admin port.
- **Modify** `.github/workflows/ci.yml` — e2e job: thread the override into every `docker compose` call, start+await the mock, repoint `PORTAINER_API_URL`.
- **Modify** `docs/architecture.md` — note the CI mock Portainer.

---

## Task 1: Fixtures + Docker-free contract test

**Files:**
- Create: `docker/portainer-mock/__files/{endpoints,endpoint,docker-info,containers,container-inspect,stacks,networks,images}.json`
- Test: `packages/core/src/portainer/portainer-mock-fixtures.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `packages/core/src/portainer/portainer-mock-fixtures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  EndpointArraySchema,
  EndpointSchema,
  ContainerArraySchema,
  ContainerInspectSchema,
  StackSchema,
  NetworkSchema,
  ImageSchema,
} from '../models/portainer.js';
import {
  normalizeEndpoint,
  applyLiveDockerInfo,
  normalizeContainer,
  normalizeStack,
} from './portainer-normalizers.js';

const here = dirname(fileURLToPath(import.meta.url)); // packages/core/src/portainer
const filesDir = join(here, '../../../../docker/portainer-mock/__files');
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(filesDir, name), 'utf8'));

describe('portainer-mock fixtures match the backend contract', () => {
  it('endpoints.json parses and yields a live-capable Docker endpoint', () => {
    const endpoints = EndpointArraySchema.parse(readFixture('endpoints.json'));
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
    const norm = endpoints.map(normalizeEndpoint);
    const ep = norm[0];
    expect(ep.id).toBe(1);
    expect(ep.type).toBe(1); // Docker local
    expect(ep.status).toBe('up');
    expect(ep.isEdge).toBe(false);
  });

  it('endpoint.json (single) parses', () => {
    const ep = normalizeEndpoint(EndpointSchema.parse(readFixture('endpoint.json')));
    expect(ep.id).toBe(1);
  });

  it('docker-info.json drives live container counts', () => {
    const info = readFixture('docker-info.json') as {
      Containers: number; ContainersRunning: number; ContainersStopped: number;
    };
    const base = normalizeEndpoint(EndpointArraySchema.parse(readFixture('endpoints.json'))[0]);
    const live = applyLiveDockerInfo(base, {
      total: info.Containers,
      running: info.ContainersRunning,
      stopped: info.ContainersStopped,
      paused: 0,
      cpu: 4,
      memory: 8_000_000_000,
    });
    expect(live.snapshotSource).toBe('live');
    expect(live.totalContainers).toBe(info.Containers);
    expect(live.containersRunning).toBe(info.ContainersRunning);
  });

  it('containers.json parses, normalizes, and includes compose-grouped + mixed-state containers', () => {
    const containers = ContainerArraySchema.parse(readFixture('containers.json')).map((c) =>
      normalizeContainer(c, 1),
    );
    expect(containers.length).toBeGreaterThanOrEqual(2);
    expect(containers.some((c) => c.state === 'running')).toBe(true);
    expect(containers.some((c) => c.state === 'exited')).toBe(true);
    // names have the leading slash stripped
    expect(containers.every((c) => !c.name.startsWith('/'))).toBe(true);
    // at least two distinct compose projects → group/stack dropdowns get options
    const projects = new Set(
      containers.map((c) => c.labels?.['com.docker.compose.project']).filter(Boolean),
    );
    expect(projects.size).toBeGreaterThanOrEqual(2);
  });

  it('container-inspect.json parses with the inspect schema', () => {
    const inspect = ContainerInspectSchema.parse(readFixture('container-inspect.json'));
    expect(inspect.Id).toBeTruthy();
  });

  it('stacks.json parses, normalizes, and links to endpoint 1', () => {
    const stacks = z.array(StackSchema).parse(readFixture('stacks.json')).map(normalizeStack);
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    expect(stacks.some((s) => s.endpointId === 1)).toBe(true);
  });

  it('networks.json and images.json parse', () => {
    expect(z.array(NetworkSchema).parse(readFixture('networks.json')).length).toBeGreaterThanOrEqual(1);
    expect(z.array(ImageSchema).parse(readFixture('images.json')).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `cd packages/core && npx vitest run src/portainer/portainer-mock-fixtures.test.ts`
Expected: FAIL — `ENOENT` (the `__files` fixtures don't exist yet).

NOTE: verify the exact shapes/signatures of `applyLiveDockerInfo`, `normalizeContainer`, `normalizeStack`, and the Zod schema export names against the actual source before finalising — adjust the test's argument objects (e.g. the `applyLiveDockerInfo` second-arg field names, `normalizeContainer(container, endpointId)` arity) to match. The intent is fixed; the exact call shapes must match the code.

- [ ] **Step 3: Create the response-body fixtures**

`docker/portainer-mock/__files/endpoints.json`:
```json
[
  {
    "Id": 1,
    "Name": "ci-docker",
    "Type": 1,
    "URL": "unix:///var/run/docker.sock",
    "Status": 1,
    "Snapshots": [],
    "TagIds": []
  }
]
```

`docker/portainer-mock/__files/endpoint.json`:
```json
{
  "Id": 1,
  "Name": "ci-docker",
  "Type": 1,
  "URL": "unix:///var/run/docker.sock",
  "Status": 1,
  "Snapshots": [],
  "TagIds": []
}
```

`docker/portainer-mock/__files/docker-info.json`:
```json
{
  "Containers": 3,
  "ContainersRunning": 2,
  "ContainersStopped": 1,
  "ContainersPaused": 0,
  "NCPU": 4,
  "MemTotal": 8000000000
}
```

`docker/portainer-mock/__files/containers.json`:
```json
[
  {
    "Id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    "Names": ["/shop-web"],
    "Image": "nginx:1.27",
    "Created": 1730000000,
    "State": "running",
    "Status": "Up 2 hours (healthy)",
    "Ports": [{ "PrivatePort": 80, "PublicPort": 8080, "Type": "tcp" }],
    "Labels": { "com.docker.compose.project": "shop" },
    "NetworkSettings": { "Networks": { "bridge": { "IPAddress": "172.17.0.2", "NetworkID": "n1", "Gateway": "172.17.0.1" } } }
  },
  {
    "Id": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    "Names": ["/shop-api"],
    "Image": "node:22-alpine",
    "Created": 1730000100,
    "State": "running",
    "Status": "Up 1 hour",
    "Ports": [],
    "Labels": { "com.docker.compose.project": "shop" },
    "NetworkSettings": { "Networks": {} }
  },
  {
    "Id": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "Names": ["/infra-db"],
    "Image": "postgres:17-alpine",
    "Created": 1730000200,
    "State": "exited",
    "Status": "Exited (0) 5 minutes ago",
    "Ports": [],
    "Labels": { "com.docker.compose.project": "infra" },
    "NetworkSettings": { "Networks": {} }
  }
]
```

`docker/portainer-mock/__files/container-inspect.json` (Docker inspect shape — served for any container id):
```json
{
  "Id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "Name": "shop-web",
  "Created": "2024-10-27T10:30:00Z",
  "State": { "Status": "running", "Running": true, "Paused": false, "Restarting": false, "Dead": false, "ExitCode": 0, "Health": { "Status": "healthy" } },
  "Config": { "Image": "nginx:1.27", "Labels": { "com.docker.compose.project": "shop" } },
  "HostConfig": { "RestartPolicy": { "Name": "unless-stopped" } },
  "NetworkSettings": { "Networks": { "bridge": { "IPAddress": "172.17.0.2", "NetworkID": "n1", "Gateway": "172.17.0.1" } }, "Ports": { "80/tcp": [{ "HostIp": "0.0.0.0", "HostPort": "8080" }] } }
}
```

`docker/portainer-mock/__files/stacks.json`:
```json
[
  { "Id": 1, "Name": "shop", "Type": 1, "EndpointId": 1, "Status": 1, "Env": [] },
  { "Id": 2, "Name": "infra", "Type": 1, "EndpointId": 1, "Status": 1, "Env": [] }
]
```

`docker/portainer-mock/__files/networks.json`:
```json
[
  { "Id": "n1", "Name": "bridge", "Driver": "bridge", "Scope": "local", "IPAM": { "Config": [{ "Subnet": "172.17.0.0/16", "Gateway": "172.17.0.1" }] }, "Containers": {} }
]
```

`docker/portainer-mock/__files/images.json`:
```json
[
  { "Id": "sha256:1111111111111111111111111111111111111111111111111111111111111111", "RepoTags": ["nginx:1.27"], "Size": 142000000, "Created": 1730000000 }
]
```

- [ ] **Step 4: Run the contract test and confirm it PASSES**

Run: `cd packages/core && npx vitest run src/portainer/portainer-mock-fixtures.test.ts`
Expected: PASS (all assertions). If a Zod parse throws, the fixture is missing/typing a field — read the failing schema in `models/portainer.ts` and fix the fixture (do NOT loosen the schema).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/core && npx tsc --noEmit`
```bash
git add docker/portainer-mock/__files packages/core/src/portainer/portainer-mock-fixtures.test.ts
git commit -m "test(e2e): Portainer mock fixtures + contract test vs real parsers (#1420)"
```

---

## Task 2: WireMock stub mappings + mapping-integrity test

**Files:**
- Create: `docker/portainer-mock/mappings/*.json`
- Test: extend `packages/core/src/portainer/portainer-mock-fixtures.test.ts`

- [ ] **Step 1: Write the failing mapping-integrity test (append to the contract test file)**

Append this `describe` block to `portainer-mock-fixtures.test.ts`:

```ts
import { readdirSync } from 'node:fs';

const mappingsDir = join(here, '../../../../docker/portainer-mock/mappings');

interface Mapping {
  request: { method: string; urlPath?: string; urlPathPattern?: string };
  response: { status: number; bodyFileName?: string; body?: string };
}

function loadMappings(): Mapping[] {
  return readdirSync(mappingsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(mappingsDir, f), 'utf8')) as Mapping);
}

function matches(m: Mapping, method: string, path: string): boolean {
  if (m.request.method !== method) return false;
  if (m.request.urlPath) return m.request.urlPath === path;
  if (m.request.urlPathPattern) return new RegExp(`^${m.request.urlPathPattern}$`).test(path);
  return false;
}

describe('portainer-mock WireMock mappings', () => {
  const mappings = loadMappings();

  it('every mapping is well-formed and its bodyFileName exists', () => {
    expect(mappings.length).toBeGreaterThanOrEqual(8);
    for (const m of mappings) {
      expect(m.request.method).toBe('GET');
      expect(Boolean(m.request.urlPath) || Boolean(m.request.urlPathPattern)).toBe(true);
      expect(m.response.status).toBe(200);
      if (m.response.bodyFileName) {
        // throws if the referenced body file is missing
        readFixture(m.response.bodyFileName);
      }
    }
  });

  it('covers every read path the E2E pages need (exactly one match each)', () => {
    const required: Array<[string, string]> = [
      ['GET', '/api/endpoints'],
      ['GET', '/api/endpoints/1'],
      ['GET', '/api/endpoints/1/docker/_ping'],
      ['GET', '/api/endpoints/1/docker/info'],
      ['GET', '/api/endpoints/1/docker/containers/json'],
      ['GET', '/api/endpoints/1/docker/containers/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2/json'],
      ['GET', '/api/stacks'],
      ['GET', '/api/endpoints/1/docker/networks'],
      ['GET', '/api/endpoints/1/docker/images/json'],
    ];
    for (const [method, path] of required) {
      const hits = mappings.filter((m) => matches(m, method, path));
      expect(hits.length, `${method} ${path} should match exactly one mapping`).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `cd packages/core && npx vitest run src/portainer/portainer-mock-fixtures.test.ts`
Expected: FAIL — `mappings/` directory doesn't exist / `length >= 8` unmet.

- [ ] **Step 3: Create the mappings**

`docker/portainer-mock/mappings/endpoints-list.json`:
```json
{ "request": { "method": "GET", "urlPath": "/api/endpoints" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "endpoints.json" } }
```

`docker/portainer-mock/mappings/endpoint-single.json`:
```json
{ "priority": 5, "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "endpoint.json" } }
```

`docker/portainer-mock/mappings/docker-ping.json`:
```json
{ "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+/docker/_ping" }, "response": { "status": 200, "headers": { "Content-Type": "text/plain" }, "body": "OK" } }
```

`docker/portainer-mock/mappings/docker-info.json`:
```json
{ "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+/docker/info" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "docker-info.json" } }
```

`docker/portainer-mock/mappings/containers-list.json`:
```json
{ "priority": 5, "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+/docker/containers/json" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "containers.json" } }
```

`docker/portainer-mock/mappings/container-inspect.json` (higher priority so it wins over the list pattern for `.../{cid}/json`):
```json
{ "priority": 1, "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+/docker/containers/[a-f0-9]+/json" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "container-inspect.json" } }
```

`docker/portainer-mock/mappings/stacks-list.json`:
```json
{ "request": { "method": "GET", "urlPath": "/api/stacks" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "stacks.json" } }
```

`docker/portainer-mock/mappings/docker-networks.json`:
```json
{ "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+/docker/networks" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "networks.json" } }
```

`docker/portainer-mock/mappings/docker-images.json`:
```json
{ "request": { "method": "GET", "urlPathPattern": "/api/endpoints/[0-9]+/docker/images/json" }, "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "bodyFileName": "images.json" } }
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `cd packages/core && npx vitest run src/portainer/portainer-mock-fixtures.test.ts`
Expected: PASS. The `container-inspect` and `containers-list` patterns are mutually exclusive (inspect requires an extra `/{cid}` segment), and the `exactly one match` assertion guards against accidental overlap.

- [ ] **Step 5: Commit**

```bash
git add docker/portainer-mock/mappings
git commit -m "test(e2e): WireMock stub mappings for the Portainer mock + coverage test (#1420)"
```

---

## Task 3: CI compose override

**Files:**
- Create: `docker/docker-compose.e2e.yml`
- Create: `docker/portainer-mock/README.md`

- [ ] **Step 1: Create the override**

`docker/docker-compose.e2e.yml`:
```yaml
# CI-only override: a canned Portainer (WireMock) so the E2E stack has fleet
# data. Layer it AFTER the base file:
#   docker compose -f docker/docker-compose.yml -f docker/docker-compose.e2e.yml ...
# The production compose file is never modified. (#1420)
services:
  portainer-mock:
    image: wiremock/wiremock:3.13.1
    command: ["--port", "8080", "--disable-banner", "--local-response-templating"]
    volumes:
      - ./portainer-mock/mappings:/home/wiremock/mappings:ro
      - ./portainer-mock/__files:/home/wiremock/__files:ro
    # Admin port published to the host so the CI wait-loop can poll readiness.
    # The backend reaches the mock via the service name on dashboard-net.
    ports:
      - "127.0.0.1:9000:8080"
    networks:
      - dashboard-net

  backend:
    depends_on:
      redis:
        condition: service_healthy
      postgres-app:
        condition: service_healthy
      timescaledb:
        condition: service_healthy
      portainer-mock:
        condition: service_started
```

- [ ] **Step 2: Validate the merged compose**

Run: `docker compose -f docker/docker-compose.yml -f docker/docker-compose.e2e.yml config -q`
Expected: exit 0, no errors (validates the override merges cleanly; `depends_on` is restated in full to be merge-safe across Compose versions).
(If `docker` is unavailable in this environment, instead `yamllint docker/docker-compose.e2e.yml` or `python -c "import yaml,sys; yaml.safe_load(open('docker/docker-compose.e2e.yml'))"` to confirm valid YAML, and note that `compose config` must be run in CI.)

- [ ] **Step 3: Add the README**

`docker/portainer-mock/README.md`:
```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add docker/docker-compose.e2e.yml docker/portainer-mock/README.md
git commit -m "ci(e2e): compose override adding a WireMock Portainer (#1420)"
```

---

## Task 4: Wire the CI e2e job

**Files:**
- Modify: `.github/workflows/ci.yml` (the `e2e` job, ~lines 279-410)

- [ ] **Step 1: Repoint the Portainer env**

In the `e2e` job `env:` block, replace:
```yaml
      PORTAINER_API_URL: http://127.0.0.1:9999
      PORTAINER_API_KEY: e2e-dummy-key
```
with:
```yaml
      # Backend talks to the WireMock Portainer (docker-compose.e2e.yml) over
      # dashboard-net by service name. (#1420)
      PORTAINER_API_URL: http://portainer-mock:8080
      PORTAINER_API_KEY: e2e-mock-key
```

- [ ] **Step 2: Thread the override into every compose invocation**

In the `e2e` job, every `docker compose -f docker/docker-compose.yml ...` must become
`docker compose -f docker/docker-compose.yml -f docker/docker-compose.e2e.yml ...`.
To keep it DRY, add a job-level env alias and use it. At the top of the job's `env:` add:
```yaml
      COMPOSE_FILES: "-f docker/docker-compose.yml -f docker/docker-compose.e2e.yml"
```
Then update the steps:
- **Build:** `docker compose $COMPOSE_FILES build backend frontend`
- **Phase 1 (databases) — also start the mock first:**
```bash
          docker compose $COMPOSE_FILES up -d portainer-mock postgres-app timescaledb

          echo "Waiting for portainer-mock..."
          timeout 60 bash -c 'until curl -sf http://localhost:9000/__admin/mappings > /dev/null 2>&1; do sleep 2; done'
          echo "Waiting for postgres-app..."
          timeout 90 bash -c 'until docker compose '"$COMPOSE_FILES"' exec -T postgres-app pg_isready -U app_user -d portainer_dashboard > /dev/null 2>&1; do sleep 3; done'
          echo "Waiting for timescaledb..."
          timeout 120 bash -c 'until docker compose '"$COMPOSE_FILES"' exec -T timescaledb pg_isready -U metrics_user -d metrics > /dev/null 2>&1; do sleep 3; done'
          echo "Databases + mock ready"
```
- **Phase 2 (app):** `docker compose $COMPOSE_FILES up -d redis backend frontend` (rest of the waits unchanged).
- **Dump logs on failure:** add `portainer-mock` to the service loop and use `$COMPOSE_FILES` in the `ps`/`logs` calls.
- **Stop application:** `docker compose $COMPOSE_FILES down -v`

(Note: `$COMPOSE_FILES` interpolation inside the single-quoted `timeout bash -c '...'` is handled by closing/reopening the quote as shown for the `exec` lines. Keep the existing structure; only the compose-file flags change.)

- [ ] **Step 3: Sanity-check the mock readiness probe**

`curl http://localhost:9000/__admin/mappings` returns the loaded stub list once WireMock is up — confirming both liveness AND that mappings mounted. The published host port `9000` matches the override's `127.0.0.1:9000:8080`.

- [ ] **Step 4: Validate the workflow file**

Run: `cd /home/simon/Documents/ai-portainer-dashboard && npx --yes @action-validator/cli .github/workflows/ci.yml 2>/dev/null || python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: valid YAML / no schema errors. (The real validation is the CI run in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(e2e): point the stack at the WireMock Portainer fixture (#1420)"
```

---

## Task 5: Docs

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a bullet under "## UI notes" → actually under a CI/testing note**

Append to `docs/architecture.md` (after the Portainer Integration section), a short subsection:
```markdown
## CI E2E Portainer fixture

The opt-in `e2e` CI job runs the production compose stack with a CI-only override
(`docker/docker-compose.e2e.yml`) that adds a **WireMock `portainer-mock`**
service serving canned fleet data from `docker/portainer-mock/{mappings,__files}`,
with the backend's `PORTAINER_API_URL` pointed at it. This lets the data-dependent
E2E specs (container list/detail, the #1310 dropdown-anchor regression guard) run
against real data. The fixtures are contract-tested against the backend's actual
Zod schemas + normalizers in `packages/core/src/portainer/portainer-mock-fixtures.test.ts`,
so they fail loudly if a parser changes. See #1420.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): document the CI WireMock Portainer fixture (#1420)"
```

---

## Task 6: Validate in CI (the real end-to-end check)

**Files:** none (operational)

- [ ] **Step 1: Push the branch and open a PR into `dev`** with `Closes #1420` in the body (this PR completes Category B; reference PR 1 #1428 and the Cat A PR #1430).

- [ ] **Step 2: Add the `e2e` label to the PR** to trigger the gated E2E job:
```bash
gh pr edit <pr-number> --add-label e2e
```

- [ ] **Step 3: Watch the run.** `gh run watch` / `gh run view --job <id> --log`. Expected: the stack comes up healthy (incl. `portainer-mock`), and the previously-failing data specs pass — `containers.spec.ts` (list/search/detail), `workload-explorer-dropdown-position.spec.ts` (all four dropdowns now render with data), plus the chrome specs. Target: **0 failed**.

- [ ] **Step 4: If specs still fail,** read the Playwright report artifact + `e2e-compose-logs`:
  - Backend log shows `CircuitBreakerOpenError` ⇒ a read path the backend needs isn't mocked (add a mapping + fixture + extend the contract test's `required` list) or `PORTAINER_API_URL` didn't reach the backend.
  - A spec asserts data the fixture doesn't contain (e.g. a specific count) ⇒ adjust the fixture (and the contract test) or the spec.
  Iterate until green. Do NOT weaken specs to pass — fix the fixture/wiring.

---

## Self-Review

**1. Spec coverage** (against `2026-06-03-e2e-ci-meaningful-suite-design.md`, PR 2):
- "CI-only override `docker-compose.e2e.yml` + repoint `PORTAINER_API_URL`" → Task 3 + Task 4. ✅
- "WireMock mock serving the read surface (`/api/endpoints`, `/endpoints/{id}`, `_ping`, `/docker/info`, `/containers/json`, `/containers/{id}/json`, `/stacks`, `/networks`, `/images/json`)" → Task 2 mappings (all nine) + Task 1 fixtures. ✅
- "1–2 Up Docker endpoints, a few containers, a couple stacks" → fixtures (1 endpoint, 3 containers/2 projects, 2 stacks). ✅
- "CI wiring: build/start mock, drop dead :9999, breaker stays closed" → Task 4. ✅
- "Un-skip data-dependent assertions" → none needed: the specs (`containers.spec.ts`, `workload-explorer-dropdown-position.spec.ts`) have no `test.skip`; they were failing purely from missing data and pass once data is present (verified by reading them during planning). Task 6 confirms in CI. ✅
- "CI step asserting the mock answers before Playwright" → Task 4 Step 2 readiness wait on `/__admin/mappings`. ✅
- Every-PR doc update → Task 5. (`.env.example` unchanged — no new production env var; the mock is CI-override only.)

**2. Placeholder scan:** Fixtures, mappings, override YAML, contract test, and CI diffs are all given in full. Task 1 Step 2 flags that the exact normalizer call-shapes must be checked against source — that's a verification instruction, not a placeholder; the assertions' intent is fixed.

**3. Type/name consistency:** schema names (`EndpointArraySchema`, `EndpointSchema`, `ContainerArraySchema`, `ContainerInspectSchema`, `StackSchema`, `NetworkSchema`, `ImageSchema`) and normalizers (`normalizeEndpoint`, `applyLiveDockerInfo`, `normalizeContainer`, `normalizeStack`) match `packages/core/src/{models,portainer}`. The container inspect id in the mapping-coverage `required` list matches the `container-inspect.json`/`containers.json` ids. The mock service name `portainer-mock` and host port `9000` are consistent across the override, the CI env (`http://portainer-mock:8080`), and the readiness probe.

**Honesty note:** Tasks 1–2 are fully verifiable offline (the contract + mapping tests run in the normal package job). Tasks 3–5 are validated by `compose config` + YAML lint. Only Task 6 needs a real CI run (the `e2e` label) — that is inherent to CI/infra work and is the definitive green check.
