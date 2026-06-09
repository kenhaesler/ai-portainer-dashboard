# Design — A meaningful E2E suite in CI (#1420, Category B)

**Status:** approved design, pending implementation
**Issue:** #1420 — *E2E smoke suite fails in CI (22/41)*
**Date:** 2026-06-03

## Problem

With the backend-startup blocker fixed (#1417), the Playwright stack comes up
healthy and the E2E suite runs for the first time — and fails **22 of 41**. The
issue split the failures into Category A (login-selector drift, fixed
separately) and Category B (*"data-dependent tests need a populated
Portainer"*).

Investigation of the failing run (`runs/26737112237`) shows **Category B is
mis-diagnosed**. The dominant failure is not "asserting absent data" — it is the
**authenticated app shell failing to render at all**:

```
expect(locator('[data-testid="sidebar"]')).toBeVisible() → element(s) not found
```

Even specs written to be data-agnostic fail: `containers.spec.ts` test 1 has a
`table.or(emptyState)` fallback, yet *neither* renders.

### Root cause (confirmed)

1. CI points the backend at a dead Portainer (`127.0.0.1:9999`).
2. The Portainer circuit breaker opens; core read routes `/api/endpoints`,
   `/api/containers`, `/api/stacks` return 5xx (logged 30+ times as
   `CircuitBreakerOpenError`).
3. The frontend `QueryClient` has **no** `throwOnError` (`query-provider.tsx`),
   so a failed query surfaces as `isError` with `data: undefined` after
   `retry: 2`.
4. Pages access that `undefined` data **unguarded** during the error state
   (e.g. `workload-explorer.tsx:111` destructures `const { data: endpoints } =
   useEndpoints()` with no guard, then builds the endpoint dropdown from it).
   This throws a **render-time TypeError**.
5. The error bubbles to the nearest `errorElement`. In `router.tsx`, the only
   `errorElement` over the authenticated subtree sits on the **`/` route — the
   same route that renders `<AppLayout>`** (router.tsx:70–72). React Router
   replaces that route's element with the error UI, so **`<AppLayout>` (sidebar
   + header) is unmounted** and replaced wholesale.

This is two intertwined defects: a **CI-fixture gap** (no Portainer data) *and*
a latent **frontend resilience bug** (an observer-first dashboard should not
lose its entire navigation shell when an upstream dependency blips).

## Goals

- The nightly E2E suite is **green and meaningful** in CI.
- A Portainer outage (or any single page error) **never removes the app shell**;
  the user keeps navigation and sees a scoped error/empty state.
- Data-dependent specs — including the #1310 dropdown-anchor regression guard and
  container-detail navigation — **actually exercise data** in CI.

## Non-goals

- Making E2E a required gate on `dev`/`main` (revisit once stable; separate
  decision).
- Category A (login-selector drift) — fixed on its own branch/PR.
- Reworking the circuit breaker or backend error semantics.

## Architecture — two independent PRs

Sequenced PR 1 → PR 2. Both `Refs #1420`; PR 2 `Closes` it.

### PR 1 — Frontend shell resilience (product fix)

*A page error must degrade in place, never unmount the shell.*

1. **Structural isolation (the guarantee).** Catch page render errors *below*
   the layout so the sidebar/header always survive. Wrap the layout's
   `<Outlet>` / `<FrozenOutlet>` in the existing
   `shared/components/feedback/error-boundary.tsx`, **or** give the child page
   routes their own `errorElement` so the error UI renders inside
   `<AppLayout>`'s `Outlet` instead of replacing the layout. Preferred:
   wrap the Outlet — it also catches non-router render throws and keeps the fix
   in one place.

2. **Per-page hardening — sweep all Portainer-dependent pages.** Audit every
   page that consumes Portainer-backed data and make it degrade gracefully:
   guard undefined data (`endpoints ?? []`) and render
   `<EmptyState variant="error">` rather than throwing. Pages already handle
   their *primary* query's `isError` (e.g. workload-explorer's container query
   at line 449); this closes the *secondary*-query gaps (`useEndpoints`, stack
   lists, fleet host info, etc.). In scope: workload-explorer, fleet-overview
   (infrastructure), metrics-dashboard, ai-monitor, container-detail, and any
   other page surfaced by the audit (network-topology, image-footprint, home
   KPIs, etc.).

3. **Tests (required).** RTL test: a child route whose query errors keeps
   `[data-testid="sidebar"]` mounted and renders the scoped error state (not the
   route-level boundary). Add per-page guards where the audit finds unguarded
   access.

**Outcome:** the chrome-only specs (navigation, infrastructure render-integrity,
metrics/ai-monitor chrome, smoke 2–3) pass **without any Portainer**, purely from
graceful degradation.

### PR 2 — CI mock Portainer (data-path coverage)

*Give CI a populated Portainer so data specs run for real.*

1. **`docker/docker-compose.e2e.yml`** — a CI-only override layered via
   `docker compose -f docker/docker-compose.yml -f docker/docker-compose.e2e.yml`.
   Adds a `portainer-mock` service on the compose network and overrides the
   backend env: `PORTAINER_API_URL=http://portainer-mock:8080`,
   `PORTAINER_API_KEY=e2e-mock-key`. The production compose is left untouched —
   we only inject the fake upstream the backend would otherwise talk to, so the
   "prod compose only" rule holds.

2. **Mock = WireMock container** (off-the-shelf, no JS to own). Stub mappings +
   response bodies are mounted from `e2e/portainer-mock/{mappings,__files}/`.
   URL matching uses `urlPathPattern` regex to cover the per-endpoint paths.
   Required read surface (driving the live-fleet pipeline + the pages):
   - `GET /api/endpoints` — 1–2 **Up Docker** endpoints (`Type` 1/2, `Status` 1;
     never Edge-Async Type 7, so they resolve `live`).
   - `GET /api/endpoints/{id}` and `GET /api/endpoints/{id}/docker/_ping`.
   - `GET /api/endpoints/{id}/docker/info` — host stats + container counts
     (drives `enrichEndpointsWithLiveDockerInfo`).
   - `GET /api/endpoints/{id}/docker/containers/json?all=…` — a handful of
     containers (so the workload table has clickable rows + populated dropdowns).
   - `GET /api/endpoints/{id}/docker/containers/{id}/json` — container inspect
     (container-detail page).
   - `GET /api/stacks` — a couple of stacks (stack overview + counts).
   - `GET /api/endpoints/{id}/docker/networks`, `…/images/json` — supporting
     panels.

3. **`.github/workflows/ci.yml`** (e2e job) — start the stack with the override,
   drop the dead `127.0.0.1:9999`, point the backend at the mock. With 200s the
   breaker stays closed and `/docker/info` enrichment yields live data.

4. **Re-enable data assertions** — un-skip / re-tighten the data-dependent specs
   (containers search + detail, workload-explorer dropdown-anchor regression
   guard) now that data is present.

**Outcome:** the full suite is green and meaningful → closes #1420.

## Testing strategy

- **PR 1:** Vitest + Testing Library. Assert the shell survives a throwing child
  route; assert hardened pages render `EmptyState`/error instead of throwing on
  `data: undefined`. Existing security/regression patterns unaffected.
- **PR 2:** the E2E suite is the test. Add a CI step asserting the mock answers
  (`curl portainer-mock/api/endpoints`) before Playwright runs, to fail fast with
  a clear message if fixtures are misconfigured.

## Sequencing & rollout

1. **Cat A** (login selector) — already committed on
   `feature/1420-fix-e2e-login-heading-selector`; ships as its own small PR.
2. **PR 1** (this branch, `feature/1420-e2e-shell-resilience-and-mock` for the
   spec; resilience work lands here) — merge first; most specs go green via
   resilience alone.
3. **PR 2** (mock Portainer) — adds the fixture; un-skips the remaining data
   specs; closes #1420.

## Risks & open questions

- **WireMock fixture drift.** If the backend adds new Portainer read paths, the
  stub set must grow or those routes 5xx again. Mitigation: the PR-1 resilience
  fix means an unmocked path degrades gracefully instead of white-screening, so
  drift causes a *visible empty state*, not a suite-wide collapse.
- **`/docker/info` shape fidelity.** The fixture must satisfy the normalizers in
  `packages/core/src/portainer/portainer-normalizers.ts` closely enough to
  resolve endpoints as `live`. Derive fixtures from the normalizer tests.
- **Flake from retries.** `retry: 2` + Playwright `retries: 2` lengthen failure
  paths; with the mock present the happy path is fast and stable.
- **Unrelated CI noise.** The run logs also show a benign TimescaleDB
  `database "metrics_user" does not exist` init-race that self-resolves before
  healthy; out of scope here, noted for awareness.
