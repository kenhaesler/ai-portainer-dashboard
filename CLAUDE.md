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

## Security (Mandatory)

1. **Auth & RBAC** — JWT via `jose` (32+ char secrets); session store in PostgreSQL, validated server-side per request. OIDC/SSO via `openid-client` v6 with PKCE; login rate-limited (`LOGIN_RATE_LIMIT`). `fastify.authenticate` on all protected routes; mutating endpoints (POST/PUT/DELETE) and sensitive reads (Backups, Settings, Cache, User Management) MUST also use `fastify.requireRole('admin')` — never assume `authenticate` alone is sufficient for admin actions.
2. **Zero default secrets** — `NODE_ENV=production` MUST fail to start if `JWT_SECRET` is the default value or < 32 chars. Never hardcode credentials.
3. **LLM safety** — All LLM interactions go through the prompt-injection guard at `packages/ai-intelligence/src/services/prompt-guard.ts` (3 layers: 25+ regexes, heuristic scoring, output sanitization). Applied to REST `/api/llm/query` and WebSocket `chat:message`. Configurable via `LLM_PROMPT_GUARD_STRICT`. Output must be sanitized to prevent system-prompt leakage or infrastructure exposure.
4. **Infrastructure isolation** — Internal services (Prometheus, Ollama, Redis) must not bind `0.0.0.0`. Use Docker internal networks; authenticate all cross-service communication.
5. **Input & data safety** — Zod on every API boundary. Parameterized SQL only (no concatenation). Strip sensitive metadata (e.g., filesystem paths in container labels) before sending to frontend.
6. **Regression tests required** — Every security fix needs a test in `backend/src/routes/security-regression-*.test.ts`, in the file matching your domain (auth, rbac, headers, prompt-guard, sockets, stream-tickets, jwt, infra), or a new per-domain file if none fits. Coverage spans auth sweep, prompt injection, false positives, rate limiting, RBAC, headers, sockets, stream tickets, JWT, and infra isolation.
7. **Observer-first integrity** — Container-mutating actions (restart/stop) are strictly opt-in and gated by both `admin` role and a Remediation Approval workflow.

For the full checklist, see `@docs/ai-instructions/security-checklist.md`.

## UI/UX Design

Premium glassmorphic dashboard: bento grids, backdrop blur cards, staggered animations, 16 themes (Glass Light/Dark, Nordic Frost, Sandstone Dusk, Obsidian Ink, Forest Night, Hyperpop Chaos, 4 Retro, 4 Catppuccin, System). Motion via Framer Motion (`LazyMotion`), charts via Recharts, primitives via Radix UI. Animated gradient mesh background (configurable). All animations respect `prefers-reduced-motion`. A global themed scrollbar in `frontend/src/index.css` (page + `.scrollbar-themed` opt-in utility) reads theme tokens via `color-mix` and applies to every overflow container; the sidebar keeps its hover-reveal scrollbar via cascade order.

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
- Run `npm run audit:prod` to check production dependency vulnerabilities locally.
- Run `npm outdated` monthly to review stale packages.

## Code Quality

- Readability first. Explicit over clever.
- Every PR must include doc updates: `docs/architecture.md`, `.env.example`, and this file.
- ESLint in each workspace. TypeScript strict mode. No over-engineering.

## Git Workflow

Branch: `dev` → `feature/<issue#>-<desc>`. PRs: `feature/* → dev` (CI runs). `dev → main` for releases. Always link PRs to issues (`Closes #<issue>`). Commits: concise, describe "why" not "what". Never ignore CI failures.

## Environment

Per-user preferences (e.g. the anomaly Sensitivity preset from #1297) live in the `user_settings(user_id, key, value)` table (migration 035). Callers MUST look up their own row via `request.user.sub` — there is no cross-user accessor, and the per-user routes (`GET/PUT /api/monitoring/sensitivity`) are gated by `fastify.authenticate` only (no admin gate — personal preference).

Copy `.env.example` to `.env`. Key vars: `PORTAINER_API_URL`, `PORTAINER_API_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `LLM_API_URL` (OpenAI-compatible base URL — `/v1/chat/completions` is auto-appended), `LLM_API_TOKEN`, `LLM_MODEL` (default `gpt-4o-mini`), `REDIS_URL`, `JWT_SECRET` (32+ chars), `POSTGRES_APP_PASSWORD`, `TIMESCALE_PASSWORD`. Harbor (optional): `HARBOR_API_URL`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET`, `HARBOR_VERIFY_SSL` (default `true`), `HARBOR_SYNC_ENABLED` (default `false`), `HARBOR_SYNC_INTERVAL_MINUTES` (default `30`), `HARBOR_CONCURRENCY` (default `5`). Harbor can also be configured via Settings UI (stored in PostgreSQL, takes precedence over env vars). eBPF traces (optional): `TRACES_INGESTION_ENABLED`, `TRACES_INGESTION_API_KEY`, `TRACES_RETENTION_DAYS` (default `7`), `TRACES_SAMPLE_RATE` (default `1.0` = no-op), `TRACES_INGEST_MAX_SPANS_PER_SEC` (default `0` = unbounded), `TRACES_ANOMALY_P95_ZSCORE` (default `3.0`, raised from `2.5` in #1294 to reduce false positives), `TRACES_ANOMALY_ERROR_RATE_PCT` (default `5`), `TRACES_ANOMALY_PER_SERVICE_MIN` (default `5` minutes — per-service anomaly rate limit, layered on top of the 10-min per-key cooldown; #1294), `TRACES_ANOMALY_MIN_SAMPLES` (default `10` — trace-path baseline warm-up, mirrors `ANOMALY_MIN_SAMPLES`; #1294), `ANOMALY_HOUROFDAY_LOOKBACK_DAYS` (default `14`, hour-of-day baseline window; #1295), `ANOMALY_HOUROFDAY_MIN_SAMPLES` (default `3`, warm-up threshold per hour bucket; #1295), `LLM_PEER_HOSTNAMES` (comma-separated, default covers Anthropic/OpenAI/Mistral/DeepSeek/Groq). See `.env.example` for full list.

## Issue Templates

When creating GitHub issues, follow the templates in `@docs/ai-instructions/issue-templates.md`.
