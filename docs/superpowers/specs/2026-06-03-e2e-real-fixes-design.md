# Design — The real #1420 E2E fixes (corrected)

**Status:** corrected design, pending review
**Issue:** #1420 — E2E smoke suite fails in CI
**Date:** 2026-06-03
**Supersedes the diagnosis in:** `2026-06-03-e2e-ci-meaningful-suite-design.md` (PR 1's "shell-resilience" premise was a misdiagnosis)

## Why this exists

The first attempt assumed the E2E failures came from the app shell unmounting when a page threw (→ PR 1, the Outlet `ErrorBoundary`). A **combined-branch CI run** (`26896200138` = `dev` + Cat A #1430 + PR 1 #1428 + PR 2 #1431) still failed **11/41**, *with no improvement from PR 1*. Reading the Playwright **traces + error-context page snapshots** (the ground truth that should have been consulted first) gives the real causes. None are PR 1's domain.

## Evidence-based root causes (all 11 combined-run failures)

| Failing tests | Ground-truth evidence | Real cause |
|---|---|---|
| `ai-monitor.spec.ts` :42 :56 :88 (+ `navigation.spec.ts` :16 :39, which route via `/health`) | trace: `GET /health` → **nginx 301** → `/health/` → `proxy_pass backend` → **backend 404** ("404 Not Found", 13 bytes) | **nginx.conf `/health` collision** — the `location /health/` block (#1229) makes bare `/health` redirect into the backend. The SPA Health route is unreachable on navigate/refresh. **Real prod bug.** |
| `smoke.spec.ts` :7 :23 :38 | snapshot = the **authenticated dashboard** (sidebar brand "Docker Insights"), not the login form | **Test design:** smoke drives the login *form* but runs in the `chromium` project, which loads cached `storageState`. `goto('/')` is already authenticated → no login page. |
| `metrics.spec.ts` :46 | shell fine; `rangeCount` = **0**. Buttons render `range.label` = "1 hour"/"6 hours"; the test regex is `/^\s*\d+\s*(m\|h\|d)\s*$/i` | **Test↔UI mismatch** — regex expects compact labels (`1h`) that the UI doesn't use. |
| `containers.spec.ts` :56 | URL stayed `/workloads` after the click. Name cell = `<FavoriteButton>` **then** the name `<button>` (which `stopPropagation`s) | **Test selector** — `firstRow.locator('button, a').first()` clicks the **favorite star**, not the name link → no navigation. |
| `workload-explorer-dropdown-position.spec.ts` :61 | `#endpoint-select` *resolved* (exists), but `click({ timeout: 100, force: true })` timed out | **Flaky timing** — the intentionally-aggressive 100 ms force-click during the entrance animation is too tight on a CI runner. (The other 4 dropdown variants pass.) |

**Standing facts:** PR 2 (mock) works — it's a prerequisite for metrics/containers/dropdown to have data, and took the suite 22→11. Cat A's selector fix (`/docker insights/i`) is *correct and still needed* — once smoke runs unauthenticated, the login heading "Docker Insights" must match. PR 1 (#1428) is decoupled (kept as standalone defense-in-depth).

## Goals

- The `e2e` suite passes **0-failed** with Cat A + PR 2 + these fixes merged.
- The real product bug — `/health` returning 404 on navigate/refresh — is fixed and regression-tested.
- Test-only fixes are minimal and don't paper over real behavior.

## Non-goals

- PR 1 (#1428) — separate, defense-in-depth; not required for green.
- Reworking the PWA service worker (the trace proved nginx, not the SW, returns the 404).

## The five fixes

### Fix 1 — nginx `/health` serves the SPA (real bug)
`frontend/nginx.conf`: add an **exact-match** location so bare `/health` is served the SPA, taking precedence over the `/health/` proxy and the catch-all:
```nginx
# Bare /health is the SPA Health & Monitoring route. Exact-match so it is
# never redirected into the backend's /health/ liveness proxy (#1420).
location = /health {
    include /etc/nginx/security-headers.conf;
    include /etc/nginx/cache-nocache.conf;
    try_files /index.html =404;
}
```
Keep `location /health/` for backend liveness sub-paths. (Investigate whether anything actually calls the frontend's `/health/`; if not, a follow-up can drop it — out of scope here.)
**Test:** extend `frontend/src/nginx-config.test.ts` to assert the `location = /health` block exists and serves `/index.html` (and that `/health/` still proxies to the backend). *Note:* this is a static-config assertion; the true proof is the E2E run (Fix-6 validation).
**Fixes:** ai-monitor ×3, navigation ×2.

### Fix 2 — smoke runs without cached auth
`playwright.config.ts`: smoke's three tests exercise the login form, so they must run with **no `storageState`**. Add `smoke.spec.ts` to a no-auth project (mirror the existing `auth` project: `testMatch: /smoke\.spec\.ts/`, no `storageState`) and add `/smoke\.spec\.ts/` to the `chromium` project's `testIgnore`. (Confirm each smoke test either logs in itself or only asserts pre-login UI.)
**Fixes:** smoke ×3. (Relies on Cat A's heading selector.)

### Fix 3 — metrics time-range regex matches real labels
`e2e/metrics.spec.ts:46`: change the range-button matcher to the actual labels, e.g. `/^\s*\d+\s*(min|hour|day)s?\s*$/i` (matches "15 min", "1 hour", "6 hours", "7 days"). Test-only.
**Fixes:** metrics:46.

### Fix 4 — containers test clicks the name, not the favorite star
`e2e/containers.spec.ts:56`: replace `firstRow.locator('button, a').first()` with a click on the **container-name** control (the styled name `<button>`), e.g. the last button in the name cell or `firstRow.getByRole('button').nth(1)` / a name-text match — or click the row body (the table has `onRowClick` → navigate). Test-only.
**Fixes:** containers:56.

### Fix 5 — relax the dropdown first-click timing
`e2e/workload-explorer-dropdown-position.spec.ts:61`: the variant's value is verifying the dropdown *anchors* (regression for #1310), not sub-100 ms responsiveness. Give the force-click a realistic budget (e.g. drop `{ timeout: 100 }`, keep `force: true`) so a CI runner can land the click while still racing the entrance animation. Test-only.
**Fixes:** dropdown:61.

## Where the work lands / merge strategy

- **This branch** `feature/1420-e2e-real-fixes` → a new PR (call it the "real fix"): Fixes 1–5 + the nginx regression test. Carries the corrected design doc.
- **Cat A #1430** and **PR 2 #1431** stay open and are **required** for green; merge order: Cat A + PR 2 + this. (Optionally this PR could be rebased to include them, but keeping them separate keeps review small.)
- **PR 1 #1428** — decoupled (retitled); merge on its own merits, not needed for #1420.
- This PR `Closes #1420` (it's the last piece).

## Validation

Unit-level (no Docker): the nginx-config test + `npm run test -w frontend`/lint for the spec/config edits. Definitive: one **combined** `e2e`-labelled (or `workflow_dispatch`) CI run on a branch carrying Cat A + PR 2 + these fixes → target **0 failed**. Reuse the throwaway `integration/1420-combined-e2e-validation` pattern (re-merge with these fixes) rather than merging unproven.

## Risks

- **nginx 301 source:** the exact-match `location = /health` should stop the redirect, but nginx location interactions can surprise — the combined E2E run is the real proof; if `/health` still 301s, inspect `merge_slashes`/`absolute_redirect off;`.
- **smoke self-login:** confirm smoke tests perform their own login (they fill credentials) — if any assumed pre-seeded auth, it needs a login step.
- **navigation:39:** snapshot was ambiguous; if it fails for a non-`/health` reason after Fix 1, diagnose separately.
- **metrics/containers** are test-only assumptions; ensure the fixes assert real, stable UI (prefer testids if the labels churn).
