# Issue #1560 — E2E flaky failures: settings sidebar timeout + workload-explorer dropdown (0,0)

- **Issue:** #1560 (bug, frontend, priority/low, e2e)
- **Branch:** `feature/1560-e2e-flaky-fixes` (off `dev`)
- **Date:** 2026-07-13

## Problem

The label-gated Playwright E2E suite has 11 pre-existing flaky failures, in two unrelated clusters:

1. **Workload Explorer filter dropdowns (8 tests, `e2e/workload-explorer-dropdown-position.spec.ts`)** — the Endpoint/Group/Stack/State selects sometimes render at viewport `(0,0)` instead of anchoring to their trigger.
2. **Settings page (3 tests, `e2e/settings.spec.ts`)** — `expect(page.locator('[data-testid="sidebar"]')).toBeVisible()` in `beforeEach` times out (10s) on `/settings`.

Both are render/timing failures independent of backend data.

## Root Causes (traced)

### B. Dropdown (0,0)
`ThemedSelect` (`frontend/src/shared/components/ui/themed-select.tsx`) uses Radix Select with `position="popper"`. Radix computes the popper coordinates from `trigger.getBoundingClientRect()` **once at open time**, then relies on Floating UI's default `autoUpdate` (scroll / resize / ResizeObserver / layout-shift) to keep it anchored. `autoUpdate` does **not** observe an ancestor CSS-transform transition.

AppLayout (`frontend/src/features/core/components/layout/app-layout.tsx`) animates the content region on entrance: `m.main` runs `initial={{ y: 12 }} → animate={{ y: 0 }}` and the per-pathname `m.div` runs `x: ±16 → 0`. Both put a live `transform` on ancestors of the trigger. When a dropdown is opened during that window (the specs deliberately race it with `force: true`), Radix snapshots a transient, offset trigger rect and never re-anchors after the transform settles — at the extreme the panel lands near viewport origin.

The prior `.spotlight-card { transform: translateZ(0) }` fix (#1310) is already in place at `frontend/src/index.css:2012-2021` and is **correct** — because Radix Select portals to `document.body`, ancestor transforms don't re-parent the fixed popper; this is purely a position-snapshot timing race, not a containing-block bug.

### A. Settings sidebar timeout
`/settings` is the heaviest route chunk in the app. `frontend/src/features/core/pages/settings.tsx:22-29` **eagerly** (statically) imports all 8 tab modules (~1,900 lines of TSX; `tab-integrations.tsx` alone is 583 lines and several pull in `@tanstack/react-table` / `DataTable`). On the single-worker CI runner (`playwright.config.ts` `workers: 1`), downloading + parsing + evaluating that chunk contends for the main thread with the app-shell's first paint, the async `LazyMotion` features chunk, and the entrance animation. That contention occasionally pushes the sidebar's first paint past the 10s `expect` timeout — on `/settings` specifically, because `/workloads` is a lighter single-table page.

The sidebar (`<aside data-testid="sidebar">` in `sidebar.tsx`) is a **sibling** of the page's Suspense boundary, so this is main-thread/resource contention, not a hard render dependency. `useSettings()` is a non-suspense `useQuery`, so data fetching is ruled out as the cause.

Secondary (local-run only): the committed `e2e/.auth/user.json` JWT is expired (`exp` ~2026-02-21). CI regenerates it every run via the `setup` project (`e2e/global-setup.ts`, REST login), so it is stale-but-harmless in CI and for any local run that executes the `setup` project first.

## Fixes

### B. `updatePositionStrategy="always"`
Add `updatePositionStrategy="always"` to `<SelectPrimitive.Content>` in `themed-select.tsx`. Radix Select's `Content` extends `PopperContentProps`, which supports `updatePositionStrategy?: 'optimized' | 'always'` (`@radix-ui/react-popper/dist/index.d.ts:38`). `"always"` passes `animationFrame: true` to Floating UI's `autoUpdate`, re-anchoring every animation frame while the panel is open. A dropdown opened mid-entrance-animation therefore self-corrects the instant the trigger's transform settles. One line; applies to every `ThemedSelect` app-wide; the `.spotlight-card` guard stays untouched. Cost: a rAF reposition loop, but only while a dropdown is open.

### A. Harden the settings cold navigation (revised after reproduction)
**Reproduction result (2026-07-13):** run against the live dev stack (`:8080` Vite-dev serving working-tree src, `:3051` backend), `e2e/settings.spec.ts` **passed all 4 tests** — the sidebar renders well under 10s locally. Symptom A does **not** reproduce on a fast machine; it is single-worker-CI main-thread contention from the heavy `/settings` chunk, not a real render dependency.

Given that, the originally-planned `React.lazy()` tab split was **not** pursued: it is entangled (`settings.tsx:33-37` re-exports named members from four tab modules, keeping them eager regardless, so a true chunk split needs a broader refactor + consumer updates) and unverifiable locally (the spec already passes). The proportionate, evidence-based fix is to **harden the cold navigation** instead: in `e2e/settings.spec.ts`, navigate with `waitUntil: 'domcontentloaded'` and give the cold `/settings` sidebar assertion a 30s bounded budget (with 60s test-timeout headroom). The sidebar still renders — this only accommodates a slow, contended runner; a genuine regression still fails, just later. This is the "spec hardening" the plan reserved for exactly this case.

### B verification
The dropdown spec requires the WireMock canned fleet data; it cannot run against the dev stack (dev Portainer is unreachable → `/workloads` shows a "Failed to load containers" error state and the filter dropdowns never mount). The `updatePositionStrategy="always"` fix is therefore verified via CI (push the branch with the `e2e` label) rather than locally.

## Safe local verification (hard volume rule)

The E2E stack (`docker compose -f docker/docker-compose.yml -f docker/docker-compose.e2e.yml`) defaults to compose project **`docker`**, whose named volumes materialize as `docker_postgres-app-data` / `docker_timescale-data` — the **same volumes the dev stack uses**. CI's teardown runs `down -v`. Running that locally would wipe the developer's dev data, which the project rules forbid.

Mitigations (both applied):
- **Run only under an isolated project:** `-p ai-portainer-e2e` for every `up`/`down`, so volumes become `ai-portainer-e2e_*`. Never run `down -v` (or any `-v` teardown) against the `docker` project. Teardown uses `down` without `-v`, or `down -v` scoped to `-p ai-portainer-e2e` only.
- **Durable fix:** add `name: ai-portainer-e2e` to `docker/docker-compose.e2e.yml` so the E2E stack (including CI) can never share or destroy the dev `docker_*` volumes. Note: `redis-data` is not a real volume today (redis runs ephemerally), so only `postgres-app-data` and `timescale-data` are at risk.

Docker commands run outside the Claude sandbox.

## Verification flow

1. Bring up the isolated E2E stack (`-p ai-portainer-e2e`); wait for `:3051/health`, `:8080/`, WireMock `:9000`.
2. Run the two specs (the `setup` project regenerates fresh auth first). Reproduce the failures; capture timing/screenshots/trace as real evidence for the root causes.
3. Apply the two code fixes (+ compose `name:`).
4. Re-run the two specs → green. Run them a few times to confirm the flakiness is gone under `workers: 1`.
5. Tear down the isolated stack safely.

## Tests

- The two existing specs are the regression coverage and must pass.
- Add/keep a focused unit assertion for the `themed-select` prop if practical (e.g. that `Content` carries `updatePositionStrategy="always"`), so the anchoring guarantee is pinned at the component level, mirroring the `.spotlight-card` guard comment.

## Acceptance criteria

- [ ] All 11 previously-failing E2E tests pass locally against the isolated stack, repeatably.
- [ ] `themed-select.tsx` sets `updatePositionStrategy="always"`.
- [ ] `settings.tsx` tabs are lazy-loaded behind Suspense.
- [ ] `docker-compose.e2e.yml` carries an isolated project `name:`.
- [ ] No dev volume (`docker_postgres-app-data` / `docker_timescale-data`) is ever destroyed.
- [ ] Docs updated where relevant; PR links `Closes #1560`.

## Files

- `frontend/src/shared/components/ui/themed-select.tsx` — add `updatePositionStrategy`.
- `frontend/src/features/core/pages/settings.tsx` — lazy tabs + Suspense.
- `docker/docker-compose.e2e.yml` — isolated project `name`.
- `e2e/workload-explorer-dropdown-position.spec.ts`, `e2e/settings.spec.ts` — hardening only if required.
- `.github/workflows/ci.yml` — only if the compose `name` change needs a matching flag.

## Out of scope

- Ungating the E2E job to run on every PR (issue calls this optional; revisit once green).
- Broad restructuring of the entrance-animation system.
