# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. AGENTS.md and GEMINI.md mirror these rules for other AI tools.

## Project Overview

AI-powered container monitoring dashboard extending Portainer with real-time insights, anomaly detection, and an LLM chat assistant. **Observer-first** — visibility comes first; actions require explicit approval via remediation workflow. Monorepo: `backend/` (Fastify 5 + PostgreSQL) and `frontend/` (React 19 + Vite).

## Mandatory Rules

1. **Tests required** — Every change needs tests. PRs without tests are blocked by CI. Backend: `backend/src/**/*.test.ts`, Packages: `packages/*/src/**/*.test.ts`, Frontend: `frontend/src/**/*.test.{ts,tsx}`, E2E: `e2e/*.spec.ts`. Both use Vitest; frontend uses jsdom + `@testing-library/react`. Never use `--no-verify`.
2. **Observer-first** — Do not add container-mutating actions without explicit request. All actions must be gated, auditable, and opt-in.
3. **Never push to `main` or `dev`** — Branch from `dev` as `feature/<issue#>-<desc>`. PRs go `feature/* → dev → main`.
4. **Never commit secrets** — No `.env`, API keys, passwords, or credentials.
5. **Never work on `NO AI` issues** — Refuse and explain.
6. **Ask before assuming** — If ambiguous, ask for clarification before proceeding.
7. **Never wipe persistent data without explicit user authorization** — Do not run `docker volume rm`, `docker volume prune`, `docker compose down -v`, `docker compose rm -v`, `DROP DATABASE`, `TRUNCATE` on app tables, or any other action that destroys shared dev/test infrastructure (e.g. the `docker_postgres-app-data`, `docker_timescale-data`, `docker_redis-data` volumes). The dev DB carries the developer's working users, settings, history, and seeded data — wiping it is **not** an acceptable shortcut for fixing a stale password, a broken row, or a CI-only test issue. If a problem looks solvable by destroying data: (a) propose the targeted alternative instead (reset only the affected user's password via `UPDATE`, fix the specific row, etc.), and (b) ask first if destruction really is the only path. **This rule applies to subagents and parallel work too** — when dispatching a subagent that may touch docker volumes or databases, restate this rule explicitly in the brief.

## Build Commands

```bash
npm install                # Install all (both workspaces)
npm run dev                # Dev server (backend + frontend)
npm run build              # Build everything
npm run lint               # Lint
npm run typecheck          # Type check
npm test                   # All tests
npm run test -w backend    # Backend only
npm run test -w frontend   # Frontend only
# Single file: cd backend && npx vitest run src/path/file.test.ts
# Package test: cd packages/core && npx vitest run src/path/file.test.ts
# Backend tests use real PostgreSQL (POSTGRES_TEST_URL env var, default: localhost:5433)
# E2E: npx playwright test (requires running backend + frontend)
# Docker: docker compose -f docker/docker-compose.dev.yml up -d
```

## Architecture

Backend uses npm workspaces under `packages/` with a `core/` kernel (`@dashboard/core`). See `@docs/ai-instructions/architecture.md` for complete directory structure. See `@packages/core/src/CLAUDE.md` for kernel boundaries and security-critical files.

**Portainer data source:** All endpoint container counts, host CPU/memory, and stack totals come from live `/docker/info` calls — Portainer's per-endpoint `Snapshots[]` is **not read**. The pipeline lives in `packages/core/src/portainer/live-fleet.ts` (`enrichEndpointsWithLiveDockerInfo`, `attachStackCounts`, `computeFleetTotals`, `collectFleetOverview`). Up Docker endpoints are `live`; Edge Async (Type 7) and any down or non-Docker endpoint are `unavailable`. `EDGE_LIVE_QUERY_ENABLED=false` is a hard kill-switch — all endpoints become `unavailable` with no fallback. Our `kpi_snapshots`/`monitoring_snapshots` history tables are unchanged; only their inputs are now live.

**Metrics Dashboard resource labels (#1429):** The Metrics Dashboard (`/metrics`) surfaces per-container CPU%/memory% **denominators**. CPU% keeps the Docker `docker stats` convention (100% = one core) with an "of N cores (max N×100%)" sub-label; memory% shows `used / limit` and flags host-total when no limit is set. The limit + online-CPU count come from a read-only `GET /api/metrics/:endpointId/:containerId/meta` endpoint (`packages/observability/src/routes/metrics.ts`) that projects the already-cached Docker stats into `{ memoryLimitBytes, onlineCpus, usedBytes }` — no schema change, no persisted data, `authenticate`-only, and degrades to nulls when stats are unavailable (a `0` limit is treated as unset). Containers are filtered with a `FleetSearch` box above the selector. The selected container name appears in the global header via the ephemeral `useHeaderContextStore` slice (`frontend/src/stores/header-context-store.ts`), set by the page and cleared on unmount.

**Unknown metric samples are excluded, never zero-filled (#1567):** `collectMetrics()` (`packages/observability/src/services/metrics-collector.ts`) returns `cpu`/`memory` as `number | null` — `null` when `system_cpu_usage` (CPU), `memory_stats.usage`, or `memory_stats.limit` (memory) is missing/non-positive in the Docker stats payload, i.e. the percentage genuinely cannot be computed this cycle. The scheduler (`packages/server/src/scheduler.ts`) skips writing that `metric_type` row entirely rather than persisting a fabricated `0` (the `metrics.value` column stays `NOT NULL` — no migration; "unknown" is the row's absence, not a null cell). Latest reads return only rows sharing each container's newest collection timestamp, so an omitted metric is not silently carried forward from an older cycle. `buildFleetResources()` (`packages/foundation/src/routes/dashboard.ts`) tracks independent CPU/memory sample counts so a container with a known memory reading but unknown CPU doesn't dilute the fleet CPU average (and vice versa), while independently known `memory_bytes` still contributes to per-stack totals. No total-node-memory fallback is used for a missing memory limit: Docker already reports host-total memory as `limit` when a container has no explicit cap, so a still-missing limit signals a malformed payload, not an unlimited container.

**Design-critique remediation (2026-07-26):** a whole-app review produced 173 findings; see
`@docs/architecture.md` ("Design-critique remediation") for the full rationale. Six invariants
worth knowing before touching UI:

1. **Navigation comes from one manifest.** `frontend/src/features/core/lib/navigation-manifest.ts`
   feeds the sidebar, breadcrumb, command palette, mobile nav and shortcuts overlay. There were
   previously six hand-maintained copies and they had drifted (breadcrumb read "Dashboard /
   Dashboard" on 7 of 20 routes; Cmd-K was missing 5 destinations). Do not add a seventh — add to
   the manifest. `navigation-manifest.test.ts` fails if an entry lacks a breadcrumb label or a
   palette entry. `NAV_CHORDS` lives there too, not in `app-layout.tsx`, because the shortcuts
   overlay needs it and `app-layout` renders that overlay (the cycle left it `undefined` at
   module-init).
2. **`useAutoRefresh` owns the timer.** Pass `{ onTick }`; never hand-roll a `window.setInterval`
   at the call site. Six pages previously showed a pulsing "live" dot over a dropdown that
   scheduled nothing. Pass a page-specific `storageKey` unless the page should share the global
   cadence. Prefer `setRefreshInterval` over the deprecated `setInterval` alias — destructuring the
   latter shadows `window.setInterval` in the consuming module. The hook **does not persist on
   mount**: only a cadence the user actually picked is written, because a page that merely stored
   its own default to the *shared* key changed every other page's cadence (opening Image Footprint,
   which asks for 60s, slowed every dashboard query). The mount-skip compares the state object by
   identity — a boolean first-run flag is spent by StrictMode's mount/cleanup/mount and writes anyway.
3. **Never render a default as if it were a measurement.** `clampConfidenceScore` and
   `parseSeverity` live in `packages/core/src/utils/model-confidence.ts` and return `null` when the
   model supplied nothing; omit the badge rather than showing a fallback number. They are in `core`
   because all three analysers need them — remediation (`@dashboard/operations`), investigation
   (`@dashboard/ai`) and PCAP (`@dashboard/security`) — and those packages may not import one
   another, so the previous single-package fix left the other two still defaulting to `0.5`. Use the
   shared helpers; do not re-add a local copy. A view that renders confidence must guard on null
   (`null * 100` is `0`, which prints a confident "Confidence: 0%" — worse than the default it
   replaced). Likewise, label rule-derived text as such (`rationaleSource`) — a threshold rule
   presented under a Brain icon as "ML-Detected" is the failure this review named most often. The
   maths is sound; it is the framing that must not overclaim.
4. **Use `PageHeader` and `PRODUCT_NAME`.** One `<h1>` per page from
   `shared/components/layout/page-header.tsx` (no gradient/icon/size-override prop, deliberately);
   the product's name comes from `shared/lib/product.ts` and is **Container Insights**.
5. **A navigating table row is an anchor, not a `role="link"` row.** `DataTable`'s `rowHref` wraps
   the first data cell in a real `<a>`; the `<tr>` deliberately keeps its implicit `row` role. An
   explicit role on the `<tr>` replaces `row` — which each `<td>`'s `cell` role requires as an
   ancestor, and the virtual scroll container declares `role="grid"` — collapsing table navigation
   for assistive tech, and nesting a link inside a link announces the destination twice.
6. **A capped list travels with its real count.** When a payload caps an array (`ALL_NAMES_CAP` in
   `incident-store.ts`, `RULE_CONTAINER_NAMES_CAP` in `reports.ts`), send the uncapped total
   alongside it and have the UI count with that. Counting the truncated array under-reports exactly
   the large fleet the cap exists for. This applies to the *sentence* describing a capped list
   too: `/traces` read "All 200 traces: … container: unknown" while 3982 matched, and an operator
   concluded the fleet had no container attribution. Say "These 200 of 3982".

**Design-critique remediation round 2 (2026-07-27):** a second review, hunting "AI slop", found
the prose was already good and the numbers were not. See `@docs/architecture.md`
("Design-critique remediation, round 2"). Five more invariants:

7. **A number and its qualifier render together, or neither renders.** Almost every round-2
   finding was one shape: the system computed the qualifier — `status='error'`, `r_squared`,
   `confidence`, the sample count, which table a value came from — and dropped it at the render
   boundary while keeping the figure it qualifies. That produced `Error Rate 10000.0%`, `p95`
   above `max`, a breach ETA for a container at 0.0% CPU, `confidence: 1.00` on every anomaly,
   and "13.8 GB total disk usage" that double-counted every shared layer. Before rendering a
   figure, ask what would let a reader discount it, and render that too — or render neither.
   Never coerce a null statistic to `0`: `percentile_cont` over an empty set and a 0/0
   satisfaction rate both printed confident zeroes.
8. **Detector and state vocabularies have exactly one definition.** `CONTAINER_STATES` lives in
   `@dashboard/contracts`; detector labels live in
   `frontend/src/features/ai-intelligence/lib/detection-method-labels.ts`. Both existed twice and
   both drifted — the fleet tile compared against Docker's `'exited'`, which the normalizer never
   emits, so Home reported "0 stopped" with six containers down; and one detector rendered as
   "ML" and "Metric anomaly" simultaneously on `/health`. Comparing a `ContainerState` against a
   Docker-native word is now a compile error. **Record an honesty rule as a test, not a comment**
   — `insight-card.tsx` had twelve lines explaining why the badge must not say "ML" and the rule
   was lost anyway.
9. **Gate an affordance on its real precondition, not on the ones you remembered.**
   `startDisabledReason` on `/packet-capture` handled three preconditions and not `PCAP_ENABLED`,
   which defaults to false — so a stock install offered a live Start Capture and answered the
   click with a server error. `GET /api/pcap/status` and `GET /api/llm/status` exist for this.
   Every disabled control names its reason; `title={canMutate ? undefined : NOT_ADMIN}` left an
   admin with no explanation at all in the state most installs start in.
10. **A guess must not wear the same treatment as a fact.** The log level column was a keyword
   grep presented as the emitter's own level — `module: "trace-store"` badged DEBUG for containing
   "trace", on the field operators triage on. `resolveLevel` prefers what the record declares and
   marks the fallback `levelSource: 'guessed'`, rendered dimmed with a `?`.
11. **Contrast and keyboard access are checked, not assumed.** `frontend/src/theme-contrast.test.ts`
   holds every theme's `--color-muted-foreground` to 4.5:1 against its own background (three light
   themes failed). The app shell has a skip link to `<main id="main-content">`; before it, reaching
   content took 22-29 Tab presses on every route. `DataTable` takes controlled
   `sorting`/`onSortingChange` — reach for that rather than hand-rolling `<span onClick>` headers,
   which is how `/reports` ended up with `aria-sort` null on all eight columns and five inert.

## Security (Mandatory)

1. **Auth & RBAC** — JWT via `jose` (32+ char secrets); session store in PostgreSQL, validated server-side per request. OIDC/SSO via `openid-client` v6 with PKCE; login rate-limited (`LOGIN_RATE_LIMIT`). OIDC roles derive only from group→role mappings on every login; the `oidc.allow_unmapped_viewer` setting (Settings → Security, default **off**/restrictive) controls the fallback: off ⇒ a login resolving to no mapped role (and no `*` wildcard) is denied `403` (`oidc_login_denied` audit) and the user's lingering sessions are revoked (`invalidateAllUserSessions`, best-effort), enforced for new *and* existing users; on ⇒ unmatched *new* users get `viewer` while existing users keep their stored role (the `resolvedRole || existingUser?.role || 'viewer'` fallback). A `*` wildcard applies even to users who present no groups. Local auth is unaffected. Gate lives in `packages/foundation/src/routes/oidc.ts`. `fastify.authenticate` on all protected routes; mutating endpoints (POST/PUT/DELETE) and sensitive reads (Backups, Settings, Cache, User Management) MUST also use `fastify.requireRole('admin')` — never assume `authenticate` alone is sufficient for admin actions. Role changes, password resets, user deletions, and OIDC group-mapping downgrades revoke all of the target's sessions immediately (`invalidateAllUserSessions`, best-effort) — the role is frozen into the signed JWT, so without revocation a demotion only takes effect at token expiry. Live Socket.IO connections re-validate their session (and the `admin` role on the remediation namespace) every 60s and are disconnected on revocation/demotion (`packages/core/src/plugins/socket-io.ts`). Insight acknowledgement is gated `requireRole('operator')`; `/health/ready/detail` is admin-only.
2. **Zero default secrets** — `NODE_ENV=production` MUST fail to start if `JWT_SECRET` is the default value or < 32 chars. Never hardcode credentials.
3. **LLM safety** — All LLM interactions go through the prompt-injection guard at `packages/ai-intelligence/src/services/prompt-guard.ts` (3 layers: 25+ regexes, heuristic scoring, output sanitization). Enforced centrally inside `chatStream()` (`packages/ai-intelligence/src/services/llm-client.ts`): every user-role message is guarded before the request leaves the process and the returned response is sanitized, covering all internal flows (log analysis, anomaly explanation, incident summaries, investigations, remediation, PCAP, forecasts, correlations) in addition to REST `/api/llm/query` and WebSocket `chat:message` (which add their own user-facing block messages and per-session canary checks). Callers must consume `chatStream`'s return value, not re-accumulate raw chunks. Live-stream consumers (chat socket, metrics ai-summary SSE) filter streamed chunks through `ThinkingBlockFilter` and finish with the sanitized return value as the authoritative message the client keeps (#1516); the ai-summary SSE GET carries a per-user rate limit and is excluded from the observer-read rate-limit bypass (#1517). Configurable via `LLM_PROMPT_GUARD_STRICT`. Output must be sanitized to prevent system-prompt leakage or infrastructure exposure.
4. **Infrastructure isolation** — Internal services (Prometheus, Ollama, Redis) must not bind `0.0.0.0`. Use Docker internal networks; authenticate all cross-service communication.
5. **Input & data safety** — Zod on every API boundary. Parameterized SQL only (no concatenation). Strip sensitive metadata (e.g., filesystem paths in container labels) before sending to frontend. Admin-supplied outbound URLs (webhooks) are validated against private/loopback/link-local/metadata ranges — including bracketed and IPv4-mapped IPv6 — via `packages/core/src/utils/network-security.ts`, re-validated at delivery time, and delivered with `redirect: 'error'` so a 3xx cannot pivot the request to an internal target (DNS-based SSRF is a known residual). The LLM probe endpoints (`POST /api/llm/test-connection`; the `?host=` override on `GET /api/llm/models`) are admin-only, and the stored provider token is never attached to a host other than the configured endpoint. In production the app refuses to start when trace ingestion is enabled with a `TRACES_INGESTION_API_KEY` shorter than 16 chars; machine-ingestion tokens (Prometheus, OTLP) are compared in constant time (`constantTimeEqual`). The global error handler (`packages/core/src/plugins/error-handler.ts`) masks 5xx bodies in production; handler-caught errors that reply with an explicit 5xx must route their `details` through `errorDetails()` from the same module so the masking applies there too (#1518).
6. **Regression tests required** — Every security fix needs a test in `backend/src/routes/security-regression-*.test.ts`, in the file matching your domain (auth, rbac, headers, prompt-guard, sockets, stream-tickets, jwt, infra), or a new per-domain file if none fits. Coverage spans auth sweep, prompt injection, false positives, rate limiting, RBAC, headers, sockets, stream tickets, JWT, and infra isolation.
7. **Observer-first integrity** — Container-mutating actions (restart/stop) are strictly opt-in and gated by both `admin` role and a Remediation Approval workflow.

**Anomaly feedback (issue #1298):** `POST /api/monitoring/anomaly-feedback` is open to any authenticated role — viewer/operator/admin may all file a "false positive" on their own behalf — but the row is always scoped to the caller's `user_id` via the JWT subject (no spoofing of other users). `GET /api/monitoring/anomaly-feedback/rates` returns caller-scoped data by default; admins receive fleet-wide aggregates (counts per detector only, never individual user dispositions) and may opt back into caller scope via `?scope=mine`. Non-admins passing `?scope=fleet` are silently downgraded to caller scope. The `detector` field on POST is restricted to a Zod allowlist — the canonical `ANOMALY_DETECTORS` constant in `packages/core/src/models/monitoring.ts` (persisted detectors + in-memory correlated detectors; single source of truth, #1314) — so client input cannot pollute the per-detector rate breakdown.

For the full checklist, see `@docs/ai-instructions/security-checklist.md`.

## UI/UX Design

Premium glassmorphic dashboard: bento grids, backdrop blur cards, staggered animations, 16 themes (Glass Light/Dark, Nordic Frost, Sandstone Dusk, Obsidian Ink, Forest Night, Hyperpop Chaos, 4 Retro, 4 Catppuccin, System). Motion via Framer Motion (`LazyMotion`), charts via Recharts, primitives via Radix UI. Animated gradient mesh background (configurable). All animations respect `prefers-reduced-motion`. A global themed scrollbar in `frontend/src/index.css` (page + `.scrollbar-themed` opt-in utility) reads theme tokens via `color-mix` and applies to every overflow container; the sidebar keeps its hover-reveal scrollbar via cascade order. Native form controls (checked checkboxes/radios, `<select>` option popups) follow each theme's light/dark via a per-theme-class `color-scheme` declaration in `index.css` (light/dark split mirrors `resolvedTheme()` in `theme-store.ts`), with `accent-color: var(--color-primary)` theming the checkbox/radio fill — without `color-scheme`, dark themes render checked native checkboxes as near-black squares and `<select>` popups as white-on-white. Tests live in `frontend/src/native-control-color-scheme.test.ts`.

**Status colors:** Green=healthy, Yellow=warning, Orange=critical, Red=error, Blue=info, Gray=inactive, Purple=AI insight.

**Empty / loading / error states:** Use `<EmptyState>` (variants: `empty` / `error` / `not-configured`) and the skeleton primitives (`SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`) in `frontend/src/shared/components/feedback/`. Skeletons live inside the caller's pane chrome — they do not wrap themselves in cards. `EmptyState` is purely informational; render any retry / settings action in the parent pane's header. See `@docs/superpowers/specs/2026-05-16-empty-loading-states-design.md` for the full rationale.

For detailed specs (animation durations, easing curves, glass override patterns, layout patterns), see `@docs/ai-instructions/ui-design-system.md`.

## Testing & Mocks

**Mocks are for CI only.** External services (Portainer API, LLM API, Redis) are unavailable in CI, so tests must mock those calls. But mocks should be minimal — only mock what CI cannot reach. Prefer real integrations wherever possible:

- **Backend DB tests**: Use real PostgreSQL via `test-db-helper.ts` (port 5433). Never mock the database.
- **Backend route tests**: Mock only external API calls (Portainer, LLM API) and auth (`app.decorate('authenticate', ...)`). Use `vi.spyOn()` with passthrough mocks (`vi.mock('module', async (importOriginal) => await importOriginal())`) so real logic runs but individual functions can be stubbed.
- **Frontend tests**: Mock API responses (`vi.spyOn(globalThis, 'fetch')` or MSW), not internal components.
- **Never mock pure utility functions** — test them directly with real inputs.
- **Keep mocks close to the boundary** — mock the HTTP call, not the service function that wraps it.

## Dependency Management

- **Always run `npm install` from the repo root** — never from `backend/` or `frontend/` directories. npm workspaces requires a single root lock file.
- **Dependabot** creates weekly PRs for npm, monthly for Docker and GitHub Actions. Triage these PRs weekly.
- **React is pinned to exact version** (no caret) since React 19 is a new major version. Update deliberately.
- `pino-pretty` is a devDependency (not shipped to production Docker images).
- Run `npm run audit:prod` to check production dependency vulnerabilities locally. **CI enforces this** (#1578) — the `Security Audit` job fails on any high-severity *production* advisory. It previously carried `continue-on-error: true` and could not fail, which let three High advisories reach `dev` with CI green.
- **Fixing a blocked audit:** prefer a lockfile refresh (`npm update <pkg>`) or a root `overrides` entry — both remove the vulnerable code rather than hiding it. Every production High this repo has hit was fixable that way, including one npm reported as `fixAvailable: false` (that field is not a reliable signal). There is deliberately no suppression allowlist; add one only when a genuinely unfixable advisory appears.
- **Do not weaken the gate.** `continue-on-error`, `|| true`, `--offline`, and lowering `--audit-level` are all asserted against in `backend/src/ci-audit-gate.test.ts`. `npm audit --offline` is the dangerous one: it exits 0 with an empty report, indistinguishable from a clean audit.
- Known gaps, so a green audit is not over-read: devDependency Highs in the root tree are not gated (`audit:all` gates at critical only), moderate production advisories are not gated, and a red job only blocks a merge if `Security Audit` is a **required status check** in branch protection.
- **Deliberate asymmetry:** `loadtests/` gates at **high** even though it is pure dev tooling that never ships, while root *devDependency* Highs are not gated at all. That is intentional — dev tooling executes on developer and CI machines that hold credentials, so it is a real supply-chain surface — but it means a High anywhere in `artillery`'s large transitive tree (OpenTelemetry, gRPC) blocks every PR in the repo, not just load-test work. Expect that, and fix it with `npm update`/`overrides` rather than by lowering the gate.
- **`npm ci` exits 0 on a lockfile that cannot fully install.** A dependency a package declares but the lockfile carries no entry for is skipped silently; `npm audit` and `npm ls --package-lock-only` do not see it either. Only **`npm ls --all`** against the installed tree catches it (this repo has been bitten twice: #1573 range drift, and `@reduxjs/toolkit` → `@standard-schema/utils`). CI gates it in the `audit` job right after `npm ci`. **`--all` is load-bearing:** bare `npm ls` validates only to depth 0 and exits 0 on precisely such a tree — a silent no-op in the same family as `npm audit --offline`. `backend/src/ci-audit-gate.test.ts` asserts the flag is present. The check cannot cover `loadtests/` — `npm ls` needs an installed tree and CI deliberately does not install there.
- **`loadtests/` has its own lockfile and the root audit cannot reach it.** It is not an npm workspace, so a root `npm audit` does not traverse it. That blind spot let a High (`ws` GHSA-96hv-2xvq-fx4p) sit in `dev` while CI stayed green — it was visible only as a Dependabot alert. It is now gated: `npm run audit:loadtests` locally, and an `Audit loadtests dependencies (high+)` step in the `audit` job, asserted by `backend/src/ci-audit-gate.test.ts`. The step needs no `npm ci` — `npm audit` resolves from the manifest plus lockfile alone. **Any future lockfile outside the workspace graph needs its own step; the root audit will not find it** — `ci-audit-gate.test.ts` discovers every `package-lock.json` in the repo and fails if one has no audit step, so this is enforced rather than remembered.
- `loadtests/package.json` carries two `overrides` (`@opentelemetry/core`, `uuid`) pinning transitive deps past advisories that `artillery` / `autocannon` had not yet picked up. npm's suggested "fix" for both was a **major downgrade** (`artillery` 2.x→1.7.9, `autocannon` 8.x→2.0.1) — do not take it. Drop each override once the upstream range moves past it; verify with `npm audit` plus an autocannon smoke run, since `hyperid` (autocannon's ID generator) is the `uuid` consumer. Note an override also pins **forward**: `@opentelemetry/core: ^2.9.0` will block a future `artillery` that needs otel core 3.x, and surfaces as a confusing resolution failure rather than an obvious stale override — check these two entries first when a `loadtests/` upgrade refuses to resolve.
- Run `npm outdated` monthly to review stale packages.

## Code Quality

- Readability first. Explicit over clever.
- Every PR must include doc updates: `docs/architecture.md`, `docker/.env.example`, and this file.
- ESLint in each workspace. TypeScript strict mode. No over-engineering.
- **Package boundaries are machine-enforced (#1585).** `packages/` dependency directions are
  checked by `eslint-plugin-boundaries` in `eslint.packages.config.mjs`; the root `npm run lint`
  covers it via the `lint:packages` script (CI runs a bare `npm run lint`). A cross-package import
  in a forbidden direction, or a package barrel re-exporting from `routes/`, **fails lint**. The
  authoritative allowed-import table is in `packages/core/src/CLAUDE.md`. Adding a package requires
  both an element descriptor and a policy entry in `eslint.packages.config.mjs` — without both its
  imports are denied by default. `tsconfig.eslint.json` exists solely to pin lint resolution of
  `@dashboard/*` to `packages/<dir>/src`: `dist/` is gitignored, so a dist-resolved config would
  pass vacuously on a fresh clone or pre-build CI run. Do not weaken either file — no blanket
  `boundaries/ignore` for tests (an over-broad ignore is what made the old `backend` rules a no-op).
  Cross-domain behaviour obtained via DI (`LLMInterface`, `MetricsInterface`, … from
  `@dashboard/contracts`, wired in `packages/server/src/wiring.ts`) is not an import and needs no
  exception.
- **`frontend/` -> `@dashboard/*` imports are machine-enforced too (#1587).** A sibling
  `eslint-plugin-boundaries` block in `frontend/eslint.config.js` allows only
  `frontend -> @dashboard/contracts`; any other `@dashboard/*` import (`core`, a domain package,
  `server`, …) **fails lint**, since only `frontend` and `contracts` are declared elements and an
  import of an undeclared package is caught by the `boundaries/no-unknown-dependencies` backstop.
  Today's only real usage is 6 `import type { ... } from '@dashboard/contracts'` sites; this keeps
  that a checked invariant instead of a convention. The root `npm run lint` reaches it via
  `npm run lint -w frontend`, and `-w <workspace>` sets that child process's cwd to `frontend/` —
  **different** from `lint:packages`, which is invoked directly from the repo root — so both
  cwd-sensitive settings (`boundaries/root-path`, the resolver's `project` path) are pinned to
  absolute paths computed from the config file's own location rather than written relative to
  either cwd; the `files:` glob that gates the whole block, however, is unavoidably cwd-relative
  (an ESLint flat-config constraint, not fixable with an absolute pattern — verified), so this
  config still has a real "must be invoked with cwd = frontend/" precondition, exactly like
  `lint:packages` has one for the repo root. Tests in `frontend/src/eslint-boundaries.test.ts`
  drive the actual shipped config through ESLint's Node API with `cwd` forced to match the real
  `npm run lint -w frontend` invocation.
- **`npm run typecheck` covers packages/ test files too (#1586).** Every `packages/*/tsconfig.build.json`
  excludes `**/*.test.ts` and `**/__tests__/**` — correctly, tests must not ship to `dist/` — but the
  root `typecheck` script used to run only `tsc --build tsconfig.build.json`, so those excluded test
  files were never typechecked by anything, hiding 49 errors across 5 packages from both local
  `npm run typecheck` and CI's `Type Check` job. Each package already had its own non-build
  `tsconfig.json` (no test exclusion) and its own `"typecheck": "tsc --noEmit"` script; the root
  script now also chains `npm run typecheck -w <pkg>` for all 9 packages before typechecking
  frontend. `backend/src/typecheck-gate.test.ts` guards both halves of the wiring — that the root
  script still invokes every package's script, and that no package's plain `tsconfig.json` regains a
  test-file exclusion — following the same "drive the actual shipped config, don't describe it"
  pattern as `ci-audit-gate.test.ts` (#1578) and `packages-boundaries.test.ts` (#1585).

## Git Workflow

Branch: `dev` → `feature/<issue#>-<desc>`. PRs: `feature/* → dev` (CI runs). `dev → main` for releases. Always link PRs to issues (`Closes #<issue>`). Commits: concise, describe "why" not "what". Never ignore CI failures.

## Environment

Per-user preferences (e.g. the anomaly Sensitivity preset from #1297) live in the `user_settings(user_id, key, value)` table (migration 036). The Sensitivity post-filter reads each insight's typed `insights.z_score` column (migration 038, #1308) rather than regex-parsing the description; detectors persist `z_score` only for z-score-based anomalies (statistical metric + trace `latency_p95`), leaving it NULL elsewhere so non-z-score insights pass through. Callers MUST look up their own row via `request.user.sub` — there is no cross-user accessor, and the per-user routes (`GET/PUT /api/monitoring/sensitivity`) are gated by `fastify.authenticate` only (no admin gate — personal preference).

Copy `docker/.env.example` to `.env`. Key vars: `PORTAINER_API_URL`, `PORTAINER_API_KEY`, `EDGE_LIVE_QUERY_ENABLED` (default `true` — set to `false` to disable all live `/docker/info` queries; affected endpoints become `unavailable`), `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `LLM_API_URL` (OpenAI-compatible base URL — `/v1/chat/completions` is auto-appended), `LLM_API_TOKEN`, `LLM_MODEL` (default `gpt-4o-mini`), `REDIS_URL`, `JWT_SECRET` (32+ chars), `POSTGRES_APP_PASSWORD`, `TIMESCALE_PASSWORD`. Harbor (optional): `HARBOR_API_URL`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET`, `HARBOR_VERIFY_SSL` (default `true`), `HARBOR_SYNC_ENABLED` (default `false`), `HARBOR_SYNC_INTERVAL_MINUTES` (default `30`), `HARBOR_CONCURRENCY` (default `5`), `HARBOR_MAX_PAGES` (default `500` = 50k items; `0` disables the cap). Harbor can also be configured via Settings UI (stored in PostgreSQL, takes precedence over env vars). eBPF traces (optional): `TRACES_INGESTION_ENABLED`, `TRACES_INGESTION_API_KEY`, `TRACES_RETENTION_DAYS` (default `7`), `TRACES_SAMPLE_RATE` (default `1.0` = no-op), `TRACES_INGEST_MAX_SPANS_PER_SEC` (default `0` = unbounded), `TRACES_ANOMALY_P95_ZSCORE` (default `3.0`, raised from `2.5` in #1294 to reduce false positives), `TRACES_ANOMALY_ERROR_RATE_PCT` (default `5`), `TRACES_ANOMALY_PER_SERVICE_MIN` (default `5` minutes — per-service anomaly rate limit, layered on top of the 10-min per-key cooldown; #1294), `TRACES_ANOMALY_MIN_SAMPLES` (default `10` — trace-path baseline warm-up, mirrors `ANOMALY_MIN_SAMPLES`; #1294), `ANOMALY_HOUROFDAY_LOOKBACK_DAYS` (default `14`, hour-of-day baseline window; #1295), `ANOMALY_HOUROFDAY_MIN_SAMPLES` (default `3`, warm-up threshold per hour bucket; #1295), `ANOMALY_DAYOFWEEK_ENABLED` (default `true`, day-of-week × hour-of-day seasonal baseline; #1307), `ANOMALY_DAYOFWEEK_LOOKBACK_DAYS` (default `28`, weekly bucket window ≈ 4 same-weekday occurrences; #1307 — on the robust path the effective lookback is clamped to `METRICS_RAW_RETENTION_DAYS` with a one-time warning when it exceeds retention; #1527), `ANOMALY_DAYOFWEEK_MIN_SAMPLES` (default `3`, warm-up per weekday×hour bucket counted as **distinct same-weekday days**, not raw samples; #1527), `ANOMALY_DETECT_CONCURRENCY` (default `8` — p-limit cap on the per-container×metric anomaly-detection fan-out and the Isolation Forest pass, protecting the shared TimescaleDB pool; #1498/#1502), `LLM_PEER_HOSTNAMES` (comma-separated, default covers Anthropic/OpenAI/Mistral/DeepSeek/Groq). See `docker/.env.example` for full list.

**Seasonal anomaly baseline (#1295, #1307):** the metric anomaly detector compares each sample against its **seasonal bucket**, falling back from the finest bucket that has data: **day-of-week × hour-of-day** (#1307) → **hour-of-day** (#1295) → **flat trailing window**. Each level falls through when below its warm-up threshold, so cold starts and sparse weekday buckets degrade gracefully (set `ANOMALY_DAYOFWEEK_ENABLED=false` for hour-of-day-only). Data source differs by detector (#1307): the mean/std path (`getMovingAverageByHourOfDay`) reads TimescaleDB's `metrics_1hour` continuous aggregate and reconstructs the exact population mean + `STDDEV_POP` from per-bucket `avg`/`stddev`/`count` via the law of total variance (`packages/observability/src/services/seasonal-baseline.ts`) — cheap and equivalent to the old raw scan; the **robust median+MAD** path (default detector) stays on the raw `metrics` hypertable (median+MAD needs raw samples, not pooled hourly averages) but adds a day-of-week filter that narrows its query; its day-of-week lookback is clamped to `METRICS_RAW_RETENTION_DAYS` and the weekly warm-up counts distinct same-weekday days, skipping the weekly query entirely when retention cannot hold enough occurrences (#1527). A PR-AUC CI regression guard (`packages/ai-intelligence/src/services/anomaly-eval.ts`) asserts a same-phase seasonal baseline beats a flat trailing window on a weekly-seasonal series.

## Issue Templates

When creating GitHub issues, follow the templates in `@docs/ai-instructions/issue-templates.md`.
