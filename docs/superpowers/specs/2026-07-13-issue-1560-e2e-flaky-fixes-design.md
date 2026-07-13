# Issue #1560 — E2E flaky failures (settings + workload-explorer specs)

- **Issue:** #1560 (bug, frontend, priority/low, e2e)
- **Branch:** `feature/1560-e2e-flaky-fixes` (off `dev`)
- **Date:** 2026-07-13

## Problem

The label-gated Playwright E2E suite has 11 intermittently-failing tests — 3 in `e2e/settings.spec.ts` and 8 in `e2e/workload-explorer-dropdown-position.spec.ts`. Both clusters fail at the same point: `expect(page.locator('[data-testid="sidebar"]')).toBeVisible()` in `beforeEach`.

## Root cause (confirmed) — session eviction, not render timing

The issue's title (and an initial pass on this branch) attributed these to **settings-chunk paint contention** and **Radix dropdown `(0,0)` positioning**. Both were wrong. Evidence disproving them:

- Against a live stack, `settings.spec.ts` **passes locally** (sidebar renders well under 10s) — so it is not slow-paint contention.
- In the failing CI run, the accessibility snapshot of the failing pages is the **login screen** (`"Sign in to your account"`): the specs are **unauthenticated**, redirected to `/login`, so the sidebar never mounts. The dropdown specs die at the same `beforeEach` sidebar wait and never reach any positioning assertion.

**Actual mechanism (traced end-to-end):**

1. `e2e/global-setup.ts` REST-logs-in as `admin` **once**, minting session **A**; its JWT is written to `e2e/.auth/user.json` (the `storageState` every spec loads).
2. The suite keeps logging in as the **same `admin`** — `auth.spec.ts`, `remediation-approval.spec.ts`, and the `e2e/helpers/{login,api}.ts` helpers all hardcode `admin` — and Playwright `retries: 2` amplifies it.
3. `createSession` (`packages/core/src/services/session-store.ts:76-92`) enforces `MAX_CONCURRENT_SESSIONS_PER_USER` (default **5**, `env.schema.ts:58`) by **DELETE-ing the oldest** valid sessions. Session A is the oldest, so it is the first evicted.
4. Once A is gone, every protected spec loading its token hits `authenticate` → `getSession(A)` returns undefined → **401** (`packages/core/src/plugins/auth.ts:54-57`).
5. The frontend API client clears auth on 401 only (`frontend/src/shared/lib/api.ts:94-97` → `auth:expired`), `isAuthenticated` becomes `!!token === false` (`auth-provider.tsx:210`), and `ProtectedRoute` renders `<Navigate to="/login">`.

This is the **only** code path that turns a valid, non-expired token into a 401. Corroboration: the CI backend log shows **59 × 401** during the run. It's intermittent because it depends on how many `admin` logins have landed when each late-running protected spec loads (settings/workload sort last alphabetically). The `FST_ERR_REP_ALREADY_SENT` / `@fastify/compress` `ERR_HTTP_HEADERS_SENT` 500s on `/api/endpoints|stacks|harbor/enabled|remediation/actions` are **benign abort noise** — the redirect unmounts the page and cancels those in-flight GETs; they are a fingerprint of the redirect, not its cause (client never sees them; 500 ≠ 401).

Ruled out: token expiry (JWT/session TTL = 60 min, run is ~12 min, refresh timer fires at ~50 min), the refresh timer, rate limiting (429 is not treated as auth-expiry), and the viewer-session invalidation in the remediation spec (scoped to a different `user_id`).

## Fixes

### 1. Raise the E2E session cap (the fix)
Add `MAX_CONCURRENT_SESSIONS_PER_USER=100` to the `backend` service env in `docker/docker-compose.e2e.yml`. This completes the existing mitigation there: the same block already raises `LOGIN_RATE_LIMIT=1000` for exactly the "many real logins from one admin" reason (#1420) — it just never raised the session cap. 100 is the schema max and far exceeds the suite's total admin logins (≈10-25 with retries), so the shared-admin churn can never evict the storage-state session. Product code and the production security feature are untouched; this is a disposable-CI-stack override only.

### 2. Radix Select re-anchoring — defensive (kept)
`updatePositionStrategy="always"` on `ThemedSelect`'s Radix `Content` (+ a source-guard test). This addresses the class of Radix-Select-opened-during-entrance-transform `(0,0)` bug the issue described. That bug could **not** be reproduced or verified here — the dropdown specs never reached positioning (they died at the auth redirect) — so this is low-risk insurance, and will be confirmed (or shown unnecessary) once the specs actually run under fix #1.

### 3. E2E compose volume isolation (kept)
`name: ai-portainer-e2e` in `docker/docker-compose.e2e.yml` so the stack's volumes are `ai-portainer-e2e_*` and CI's `down -v` can never destroy the dev `docker_postgres-app-data` / `docker_timescale-data` volumes. Verified transparent to CI via `docker compose config` (CI invokes every op via the layered `-f` form, service names only).

### Reverted
The settings cold-nav timeout hardening (`waitUntil: 'domcontentloaded'` + 30s sidebar budget) was based on the incorrect paint-contention diagnosis and is removed — with fix #1 the sidebar renders normally within the default budget.

## Verification

CI E2E run gated by the `e2e` label (the suite needs WireMock fleet data and can't run against a dev stack with an unreachable Portainer). Expect all 11 previously-failing specs to pass once the storage-state session is no longer evicted; the dropdown specs will then actually exercise positioning, validating (or retiring) fix #2.

## Files
- `docker/docker-compose.e2e.yml` — `MAX_CONCURRENT_SESSIONS_PER_USER=100` (fix) + isolated project `name`.
- `frontend/src/shared/components/ui/themed-select.tsx` (+ `.test.ts`) — defensive `updatePositionStrategy="always"`.
- **Reverted:** `e2e/settings.spec.ts` (back to original).
- **Not changed:** `frontend/src/features/core/pages/settings.tsx`, `.github/workflows/ci.yml`.

## Out of scope
- The `FST_ERR_REP_ALREADY_SENT` abort-noise on cancelled requests (cosmetic log noise; could be quieted by handling client-abort in the compress `onSend`, tracked separately if desired).
- Making the login helpers use distinct ephemeral users (a more thorough test-hygiene change; the cap raise is the minimal fix).
