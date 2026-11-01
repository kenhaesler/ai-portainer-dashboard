# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. AGENTS.md and GEMINI.md mirror these rules for other AI tools.

## Project Overview

AI-powered container monitoring dashboard extending Portainer with real-time insights, anomaly detection, and an LLM chat assistant. **Observer-first** — visibility comes first; actions require explicit approval via remediation workflow. Monorepo: `backend/` (Fastify 5 + PostgreSQL) and `frontend/` (React 19 + Vite).

## Read these when relevant

- `docs/claude/architecture.md`: REQUIRED before structural or cross-package changes.
- `docs/claude/ui-ux.md`: REQUIRED before any UI change.
- `docs/claude/dependencies-and-quality.md`: REQUIRED before changing dependencies; code-quality conventions.
- `docs/claude/environment.md`: read before changing configuration or environment variables.

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

## Security (Mandatory)

1. **Auth & RBAC** — JWT via `jose` (32+ char secrets); session store in PostgreSQL, validated server-side per request. OIDC/SSO via `openid-client` v6 with PKCE; login rate-limited (`LOGIN_RATE_LIMIT`). OIDC roles derive only from group→role mappings on every login; the `oidc.allow_unmapped_viewer` setting (Settings → Security, default **off**/restrictive) controls the fallback: off ⇒ a login resolving to no mapped role (and no `*` wildcard) is denied `403` (`oidc_login_denied` audit) and the user's lingering sessions are revoked (`invalidateAllUserSessions`, best-effort), enforced for new *and* existing users; on ⇒ unmatched *new* users get `viewer` while existing users keep their stored role (the `resolvedRole || existingUser?.role || 'viewer'` fallback). A `*` wildcard applies even to users who present no groups. Local auth is unaffected. Gate lives in `packages/foundation/src/routes/oidc.ts`. `fastify.authenticate` on all protected routes; mutating endpoints (POST/PUT/DELETE) and sensitive reads (Backups, Settings, Cache, User Management) MUST also use `fastify.requireRole('admin')` — never assume `authenticate` alone is sufficient for admin actions. Edge Async log collection/polling and eBPF coverage verification are explicitly admin-only because they create/delete Portainer jobs or persist verification state. Role changes, password resets, user deletions, and OIDC group-mapping downgrades revoke all of the target's sessions immediately (`invalidateAllUserSessions`, best-effort) — the role is frozen into the signed JWT, so without revocation a demotion only takes effect at token expiry. Live Socket.IO connections re-validate their session (and the `admin` role on the remediation namespace) every 60s and are disconnected on revocation/demotion (`packages/core/src/plugins/socket-io.ts`). Insight acknowledgement is gated `requireRole('operator')`; `/health/ready/detail` is admin-only.
2. **Zero default secrets** — `NODE_ENV=production` MUST fail to start if `JWT_SECRET` is the default value or < 32 chars. Never hardcode credentials.
3. **LLM safety** — All LLM interactions go through the prompt-injection guard at `packages/ai-intelligence/src/services/prompt-guard.ts` (3 layers: 25+ regexes, heuristic scoring, output sanitization). Enforced centrally inside `chatStream()` (`packages/ai-intelligence/src/services/llm-client.ts`): every user-role message is guarded before the request leaves the process and the returned response is sanitized, covering all internal flows (log analysis, anomaly explanation, incident summaries, investigations, remediation, PCAP, forecasts, correlations) in addition to REST `/api/llm/query` and WebSocket `chat:message` (which add their own user-facing block messages and per-session canary checks). Callers must consume `chatStream`'s return value, not re-accumulate raw chunks. Live-stream consumers (chat socket, metrics ai-summary SSE) filter streamed chunks through `ThinkingBlockFilter` and finish with the sanitized return value as the authoritative message the client keeps (#1516); the ai-summary SSE GET carries a per-user rate limit and is excluded from the observer-read rate-limit bypass (#1517). Configurable via `LLM_PROMPT_GUARD_STRICT`. Output must be sanitized to prevent system-prompt leakage or infrastructure exposure. Buffered internal callers pass `{ stream: false }` so the shared gateway is not held on SSE slots nobody consumes; only true live-stream consumers (chat socket, metrics ai-summary SSE) stream, and the chat socket's `streamLlmCall` goes through the shared `runWithLlmLimit` pLimit(2) gate so interactive traffic cannot exceed the same concurrency budget as `chatStream` (#1667). This gating is not yet universal: the direct `llmFetch` call sites in `packages/ai-intelligence/src/routes/llm.ts` (`/api/llm/query`, `/api/llm/test-prompt`) and `routes/llm-feedback.ts` bypass both the limiter and the `max_tokens` cap — tracked as a follow-up issue.
4. **Infrastructure isolation** — Internal services (Prometheus, Ollama, Redis) must not bind `0.0.0.0`. Use Docker internal networks; authenticate all cross-service communication.
5. **Input & data safety** — Zod on every API boundary. Parameterized SQL only (no concatenation), including Timescale retention table/interval arguments. Strip sensitive metadata (e.g., filesystem paths in container labels) before sending to frontend. Admin-supplied outbound URLs (webhooks and Elasticsearch endpoints) are validated against private/loopback/link-local/metadata ranges — including bracketed and IPv4-mapped IPv6 — via `packages/core/src/utils/network-security.ts`, re-validated when consumed to cover legacy rows, and delivered with `redirect: 'error'` so a 3xx cannot pivot the request to an internal target (DNS-based SSRF is a known residual). Dynamic values must not be concatenated into shell source: Edge log inputs are allowlisted and bounded at both route and service boundaries; PCAP filters travel as a single argv value. OIDC nested claim resolution follows own data properties only and never traverses prototypes. The LLM probe endpoints (`POST /api/llm/test-connection`; the `?host=` override on `GET /api/llm/models`) are admin-only, and the stored provider token is never attached to a host other than the configured endpoint. In production the app refuses to start when trace ingestion is enabled with a `TRACES_INGESTION_API_KEY` shorter than 16 chars; machine-ingestion tokens (Prometheus, OTLP) are compared in constant time (`constantTimeEqual`). The global error handler (`packages/core/src/plugins/error-handler.ts`) masks 5xx bodies in production; handler-caught errors that reply with an explicit 5xx must use a stable `error` and route diagnostics through `errorDetails()` from the same module so production masking applies there too (#1518).
6. **Regression tests required** — Every security fix needs a test in `backend/src/routes/security-regression-*.test.ts`, in the file matching your domain (auth, rbac, headers, prompt-guard, sockets, stream-tickets, jwt, infra), or a new per-domain file if none fits. Coverage spans auth sweep, prompt injection, false positives, rate limiting, RBAC, headers, sockets, stream tickets, JWT, and infra isolation.
7. **Observer-first integrity** — Container-mutating actions (restart/stop) are strictly opt-in and gated by both `admin` role and a Remediation Approval workflow.

**Anomaly feedback (issue #1298):** `POST /api/monitoring/anomaly-feedback` is open to any authenticated role — viewer/operator/admin may all file a "false positive" on their own behalf — but the row is always scoped to the caller's `user_id` via the JWT subject (no spoofing of other users). `GET /api/monitoring/anomaly-feedback/rates` returns caller-scoped data by default; admins receive fleet-wide aggregates (counts per detector only, never individual user dispositions) and may opt back into caller scope via `?scope=mine`. Non-admins passing `?scope=fleet` are silently downgraded to caller scope. The `detector` field on POST is restricted to a Zod allowlist — the canonical `ANOMALY_DETECTORS` constant in `packages/core/src/models/monitoring.ts` (persisted detectors + in-memory correlated detectors; single source of truth, #1314) — so client input cannot pollute the per-detector rate breakdown.

For the full checklist, see `@docs/ai-instructions/security-checklist.md`.

## Testing & Mocks

**Mocks are for CI only.** External services (Portainer API, LLM API, Redis) are unavailable in CI, so tests must mock those calls. But mocks should be minimal — only mock what CI cannot reach. Prefer real integrations wherever possible:

- **Backend DB tests**: Use real PostgreSQL via `test-db-helper.ts` (port 5433). Never mock the database.
- **Backend route tests**: Mock only external API calls (Portainer, LLM API) and auth (`app.decorate('authenticate', ...)`). Use `vi.spyOn()` with passthrough mocks (`vi.mock('module', async (importOriginal) => await importOriginal())`) so real logic runs but individual functions can be stubbed.
- **Frontend tests**: Mock API responses (`vi.spyOn(globalThis, 'fetch')` or MSW), not internal components.
- **Never mock pure utility functions** — test them directly with real inputs.
- **Keep mocks close to the boundary** — mock the HTTP call, not the service function that wraps it.

## Git Workflow

Branch: `dev` → `feature/<issue#>-<desc>`. PRs: `feature/* → dev` (CI runs). `dev → main` for releases. Always link PRs to issues (`Closes #<issue>`). Commits: concise, describe "why" not "what". Never ignore CI failures.

## Issue Templates

When creating GitHub issues, follow the templates in `@docs/ai-instructions/issue-templates.md`.
