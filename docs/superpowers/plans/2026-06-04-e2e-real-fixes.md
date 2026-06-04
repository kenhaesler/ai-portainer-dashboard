# Real #1420 E2E Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `e2e` suite pass 0-failed by fixing the one real bug (nginx hijacks the SPA `/health` route → 404) and four test-only defects (smoke cached-auth, metrics label regex, containers click-target, dropdown timing).

**Architecture:** One product change in `frontend/nginx.conf` (an exact-match `location = /health` so bare `/health` serves the SPA, with a static regression test) plus four edits under `e2e/` and `playwright.config.ts`. Definitive validation is a single combined `e2e` CI run on a branch carrying Cat A (#1430) + PR 2 (#1431) + these fixes.

**Tech Stack:** nginx, Vitest (config assertion), Playwright, React Router.

**Branch:** `feature/1420-e2e-real-fixes` (off `dev`; carries `docs/superpowers/specs/2026-06-03-e2e-real-fixes-design.md`). Pre-existing unstaged `.gitignore`/`CLAUDE.md` (Semgrep plugin) must NOT be staged.

---

## File Structure
- **Modify** `frontend/nginx.conf` — add `location = /health` (exact match → SPA).
- **Modify** `frontend/src/nginx-config.test.ts` — assert the bare-`/health` SPA rule + that `/health/` still proxies.
- **Modify** `playwright.config.ts` — run `smoke.spec.ts` in a no-`storageState` project; ignore it in `chromium`.
- **Modify** `e2e/metrics.spec.ts` — range-button regex matches real labels.
- **Modify** `e2e/containers.spec.ts` — click the container-name button, not the favorite star.
- **Modify** `e2e/workload-explorer-dropdown-position.spec.ts` — drop the too-tight 100 ms force-click timeout.

---

## Task 1: nginx serves the SPA for bare `/health` (real bug + regression test)

**Files:**
- Modify: `frontend/nginx.conf`
- Test: `frontend/src/nginx-config.test.ts`

- [ ] **Step 1: Write the failing test.** Append to the `describe('nginx hardening config', ...)` block in `frontend/src/nginx-config.test.ts`:

```ts
  it('serves the SPA for the bare /health route instead of proxying to the backend (#1420)', () => {
    const nginxPath = path.resolve(process.cwd(), 'nginx.conf');
    const config = fs.readFileSync(nginxPath, 'utf8');

    // Exact-match location so a direct navigation/refresh of the SPA Health
    // page serves index.html and is never 301'd into the /health/ backend proxy.
    expect(config).toMatch(
      /location\s*=\s*\/health\s*\{[^}]*try_files\s+\/index\.html/s,
    );
    // The /health/ sub-path backend liveness proxy is preserved.
    expect(config).toContain('location /health/');
  });
```

- [ ] **Step 2: Run it, confirm it FAILS.**
Run: `cd frontend && npx vitest run src/nginx-config.test.ts`
Expected: FAIL on the `location = /health` matcher (no such block yet).

- [ ] **Step 3: Add the exact-match block to `frontend/nginx.conf`.** Immediately *before* the existing `location /health/ {` block, insert:

```nginx
        # Bare /health is the SPA Health & Monitoring route. Exact-match wins
        # over the /health/ backend proxy and the SPA catch-all, so a direct
        # navigation or refresh serves index.html instead of 301'ing into the
        # backend (which 404s). (#1420)
        location = /health {
            include /etc/nginx/security-headers.conf;
            include /etc/nginx/cache-nocache.conf;
            try_files /index.html =404;
        }

```
(Leave the existing `location /health/ { ... proxy_pass http://backend:3051; ... }` block exactly as-is, directly after this.)

- [ ] **Step 4: Run the test, confirm it PASSES.**
Run: `cd frontend && npx vitest run src/nginx-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint the nginx test file.**
Run: `cd frontend && npx eslint src/nginx-config.test.ts`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add frontend/nginx.conf frontend/src/nginx-config.test.ts
git commit -m "fix(frontend): serve the SPA for bare /health (was 404 via backend proxy) (#1420)

Direct navigation/refresh of the Health & Monitoring page (/health) was
301'd to /health/ and proxied to the backend, which 404s. Add an exact-match
nginx location so bare /health serves index.html; keep /health/ proxying
backend liveness sub-paths.

Refs #1420"
```

> Note: the static test asserts the rule exists; the behavioural proof (bare `/health` → 200 SPA) is the combined E2E run in Task 4.

---

## Task 2: smoke.spec.ts runs without cached auth

**Files:**
- Modify: `playwright.config.ts`

Context: `playwright.config.ts` defines projects `setup` (writes auth state), `auth` (`testMatch: /auth\.spec\.ts/`, no `storageState`), and `chromium` (`testIgnore: [/auth\.spec\.ts/, /global-setup\.ts/]`, `dependencies: ['setup']`, `storageState: 'e2e/.auth/user.json'`). `smoke.spec.ts` currently runs under `chromium` (cached auth), so `goto('/')` is already authenticated and the login form never appears.

- [ ] **Step 1: Add a no-auth `smoke` project and exclude smoke from `chromium`.** In `playwright.config.ts`:

Add this project to the `projects` array (after the `auth` project):
```ts
    /* Smoke tests drive the login *form*, so they must NOT use cached auth. */
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
```
And extend the `chromium` project's `testIgnore` to also ignore smoke:
```ts
        testIgnore: [/auth\.spec\.ts/, /global-setup\.ts/, /smoke\.spec\.ts/],
```

- [ ] **Step 2: Verify the projects resolve and smoke is collected once, without cached auth.**
Run: `npx playwright test smoke.spec.ts --list`
Expected: the three `smoke.spec.ts` tests are listed under the `[smoke]` project (NOT `[chromium]`), and each appears exactly once.

- [ ] **Step 3: Confirm smoke tests are self-contained logins (no hidden reliance on cached state).** Read `e2e/smoke.spec.ts`: each test must `page.goto('/')` and either assert the login UI or fill `username`/`password` and submit. (They do — test 1 asserts the heading then logs in; tests 2/3 log in then assert dashboard.) No code change expected; if any test assumed pre-seeded auth, add the login steps. Record what you confirmed.

- [ ] **Step 4: Commit.**
```bash
git add playwright.config.ts
git commit -m "test(e2e): run smoke specs without cached auth so the login flow is exercised (#1420)

smoke.spec.ts drives the login form but ran under the chromium project's
cached storageState, so goto('/') was already authenticated and the login
page never rendered. Give smoke its own no-storageState project and exclude
it from chromium.

Refs #1420"
```

---

## Task 3: three test-only assertion fixes (metrics, containers, dropdown)

**Files:**
- Modify: `e2e/metrics.spec.ts`
- Modify: `e2e/containers.spec.ts`
- Modify: `e2e/workload-explorer-dropdown-position.spec.ts`

### 3a — metrics range-button labels

The UI renders full labels (`TIME_RANGES` = `15 min`, `30 min`, `1 hour`, `6 hours`, `24 hours`, `7 days`), but the test matches compact `1h`-style labels → 0 matches.

- [ ] **Step 1:** In `e2e/metrics.spec.ts` (the `renders the time-range selector with multiple options` test, ~line 52), replace:
```ts
    const ranges = page.getByRole('button', {
      name: /^\s*\d+\s*(m|h|d)\s*$/i,
    });
```
with:
```ts
    // Buttons render full labels: "15 min", "1 hour", "6 hours", "7 days".
    const ranges = page.getByRole('button', {
      name: /^\s*\d+\s*(min|hour|day)s?\s*$/i,
    });
```

- [ ] **Step 2:** `npx playwright test metrics.spec.ts --list` → parses, test still listed. Commit:
```bash
git add e2e/metrics.spec.ts
git commit -m "test(e2e): match metrics time-range buttons by their real labels (#1420)"
```

### 3b — containers click the name button, not the favorite star

The name cell renders `<FavoriteButton>` (a star `<button>`) **then** the navigating name `<button>` (which `stopPropagation`s). `firstRow.locator('button, a').first()` clicks the star → no navigation.

- [ ] **Step 1:** In `e2e/containers.spec.ts` (the `clicking a container name opens the detail view` test, ~lines 60-65), replace:
```ts
    // Click the container name link (first link/button in the row)
    const containerLink = firstRow.locator('button, a').first();
    await containerLink.click();
```
with:
```ts
    // The name cell is the first column; it holds a FavoriteButton (star) and
    // then the container-name button that navigates to the detail page. Click
    // the name button (the last button in that cell), not the star.
    const containerLink = firstRow.locator('td').first().getByRole('button').last();
    await containerLink.click();
```

- [ ] **Step 2:** `npx playwright test containers.spec.ts --list` → parses. Commit:
```bash
git add e2e/containers.spec.ts
git commit -m "test(e2e): click the container-name button (not the favorite star) for detail nav (#1420)"
```

### 3c — relax the dropdown entrance-animation click

The variant verifies the dropdown *anchors* (regression for #1310); the `{ timeout: 100 }` force-click is too tight on a CI runner. `force: true` already skips actionability waits, so it still races the entrance animation without the artificial 100 ms cap.

- [ ] **Step 1:** In `e2e/workload-explorer-dropdown-position.spec.ts` (the `first-click during MotionStagger entrance animation still anchors` test, ~line 76), replace:
```ts
    await trigger.click({ timeout: 100, force: true });
```
with:
```ts
    // force:true skips the actionability waits, so the click still races the
    // entrance animation; the artificial 100ms cap just flaked on CI runners.
    await trigger.click({ force: true });
```
Also update the preceding comment if it references the 100 ms cap (lines ~73-75) so it stays accurate.

- [ ] **Step 2:** `npx playwright test workload-explorer-dropdown-position.spec.ts --list` → parses. Commit:
```bash
git add e2e/workload-explorer-dropdown-position.spec.ts
git commit -m "test(e2e): drop the too-tight 100ms force-click on the dropdown entrance variant (#1420)"
```

---

## Task 4: Combined E2E validation (the real proof)

**Files:** none (operational). Requires the billed `e2e` CI run — get the user's go-ahead before triggering.

- [ ] **Step 1: Build the combined branch.** From `dev`, create a fresh integration branch and merge Cat A + PR 2 + this branch:
```bash
git switch dev && git switch -c integration/1420-combined-v2
git merge --no-ff --no-edit feature/1420-fix-e2e-login-heading-selector   # Cat A
git merge --no-ff --no-edit feature/1420-ci-mock-portainer                # PR 2
git merge --no-ff --no-edit feature/1420-e2e-real-fixes                   # this
```
Resolve any conflicts (none expected; `architecture.md` notes are in different sections).

- [ ] **Step 2: Push + dispatch CI.**
```bash
git push -u origin integration/1420-combined-v2
gh workflow run ci.yml --ref integration/1420-combined-v2
```
Find the run: `gh run list --workflow ci.yml --branch integration/1420-combined-v2 --event workflow_dispatch --limit 1`.

- [ ] **Step 3: Watch + read the result.**
```bash
gh run watch <run-id> --interval 60
gh run view --job <e2e-job-id> --log | grep -E "[0-9]+ (passed|failed)"
```
Expected: **0 failed** (41 passed). If failures remain, pull the `playwright-report` artifact and read the error-context `.md` page snapshots in `data/` (NOT just the backend logs) to classify, fix on `feature/1420-e2e-real-fixes`, re-merge, re-run.

- [ ] **Step 4: Clean up the throwaway branches** once green:
```bash
git push origin --delete integration/1420-combined-v2 integration/1420-combined-e2e-validation
git branch -D integration/1420-combined-v2 integration/1420-combined-e2e-validation
```

---

## Self-Review

**1. Spec coverage:** Fix 1 (nginx /health)→Task 1; Fix 2 (smoke auth)→Task 2; Fix 3 (metrics regex)→Task 3a; Fix 4 (containers selector)→Task 3b; Fix 5 (dropdown timing)→Task 3c; validation→Task 4. Merge strategy (Cat A + PR 2 + this; PR 1 decoupled)→Task 4 Step 1. ✅ All spec fixes covered.

**2. Placeholder scan:** Every code step has the exact before/after. Task 2 Step 3 is a confirmation step (read + verify smoke self-logs), not a placeholder. No "TBD"/"handle edge cases". ✅

**3. Consistency:** Selectors/labels match the investigated source — metrics labels (`min|hour|day`), the name-cell structure (`td` first → FavoriteButton then name button → `.last()`), the dropdown line (`click({ timeout: 100, force: true })`), and the nginx blocks (`location = /health` / `location /health/`). The `smoke` project name is used consistently in Task 2. ✅

**Honesty note:** Tasks 1–3 are verifiable offline only at the parse/static level (nginx-config vitest; `playwright --list`). The behavioural proof for all five is the Task 4 combined CI run — inherent to E2E. Only Fix 1 changes product behaviour; 2–5 correct tests to match real, working UI.
