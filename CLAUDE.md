# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. AGENTS.md and GEMINI.md mirror these rules for other AI tools.

## Project Overview

AI-powered container monitoring dashboard extending Portainer with real-time insights, anomaly detection, and an LLM chat assistant. **Observer-first** — visibility comes first; actions require explicit approval via remediation workflow. Monorepo: `backend/` (Fastify 5 + PostgreSQL) and `frontend/` (React 19 + Vite).

## Mandatory Rules

1. **Tests required** — Every change needs tests. PRs without tests are blocked by CI. Backend: `backend/src/**/*.test.ts`, Frontend: `frontend/src/**/*.test.{ts,tsx}`, E2E: `e2e/*.spec.ts`. Both use Vitest; frontend uses jsdom + `@testing-library/react`. Never use `--no-verify`.
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
# Backend tests use real PostgreSQL (POSTGRES_TEST_URL env var, default: localhost:5433)
# E2E: npx playwright test (requires running backend + frontend)
# Docker: docker compose -f docker/docker-compose.dev.yml up -d
```

## Architecture

See `@docs/ai-instructions/architecture.md` for complete backend/frontend directory structure and key patterns.

## Security (Project-Specific)

- JWT via `jose` (32+ char secrets). Session store in PostgreSQL — validated server-side per request.
- OIDC/SSO via `openid-client` v6 with PKCE. Rate limiting on login (`LOGIN_RATE_LIMIT`).
- Auth decorator: `fastify.authenticate` on all protected routes.
- **Prompt injection guard** (`services/prompt-guard.ts`): 3-layer (regex 25+, heuristic scoring, output sanitization). Applied to REST `/api/llm/query` and WebSocket `chat:message`. Configurable: `LLM_PROMPT_GUARD_STRICT`.
- Security regression tests: `backend/src/routes/security-regression.test.ts` (36 tests — auth sweep, prompt injection, false positives, rate limiting).
- For the full checklist, see `@docs/ai-instructions/security-checklist.md`.

## Security First (Mandatory)

1. **RBAC by Default** — All mutating endpoints (POST/PUT/DELETE) and sensitive read endpoints (Backups, Settings, Cache, User Management) MUST require `fastify.requireRole('admin')`. Never assume `fastify.authenticate` is sufficient for administrative actions.
2. **Zero Default Secrets** — Production deployments (`NODE_ENV=production`) MUST fail to start if `JWT_SECRET` is the default value or less than 32 characters. Never hardcode credentials.
3. **LLM Safety** — All LLM interactions must pass through the Prompt Injection Guard. Output must be sanitized to prevent system prompt leakage or infrastructure detail exposure to unauthorized users.
4. **Infrastructure Isolation** — Internal services (Prometheus, Ollama, Redis) must not be exposed on `0.0.0.0`. Use internal Docker networks. Authenticate all cross-service communication.
5. **Input & Data Safety** — Use Zod for all API boundaries. Use parameterized SQL only (no concatenation). Strip sensitive metadata (like filesystem paths in container labels) before sending to frontend.
6. **Regression Testing** — Every security fix must include a corresponding test in `backend/src/routes/security-regression.test.ts`.
7. **Observer-First Integrity** — Mutating actions (restart/stop containers) are strictly opt-in and must be gated by both an 'Admin' role and a 'Remediation Approval' workflow.

## UI/UX Design

Premium glassmorphic dashboard: bento grids, backdrop blur cards, staggered animations, 9 themes (light/dark, Apple, Catppuccin family). Motion via Framer Motion (`LazyMotion`), charts via Recharts, primitives via Radix UI. Animated gradient mesh background (configurable). All animations respect `prefers-reduced-motion`.

**Status colors:** Green=healthy, Yellow=warning, Orange=critical, Red=error, Blue=info, Gray=inactive, Purple=AI insight.

For detailed specs (animation durations, easing curves, glass override patterns, layout patterns), see `@docs/ai-instructions/ui-design-system.md`.

## Code Quality

- Readability first. Explicit over clever.
- Every PR must include doc updates: `docs/architecture.md`, `.env.example`, and this file.
- ESLint in each workspace. TypeScript strict mode. No over-engineering.

## Git Workflow

Branch: `dev` → `feature/<issue#>-<desc>`. PRs: `feature/* → dev` (CI runs). `dev → main` for releases. Always link PRs to issues (`Closes #<issue>`). Commits: concise, describe "why" not "what". Never ignore CI failures.

## Environment

Copy `.env.example` to `.env`. Key vars: `PORTAINER_API_URL`, `PORTAINER_API_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `OLLAMA_BASE_URL` (default `http://host.docker.internal:11434`), `OLLAMA_MODEL` (default `llama3.2`), `REDIS_URL`, `JWT_SECRET` (32+ chars), `POSTGRES_APP_PASSWORD`, `TIMESCALE_PASSWORD`. Harbor (optional): `HARBOR_API_URL`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET`, `HARBOR_VERIFY_SSL` (default `true`), `HARBOR_SYNC_ENABLED` (default `false`), `HARBOR_SYNC_INTERVAL_MINUTES` (default `30`), `HARBOR_CONCURRENCY` (default `5`). Harbor can also be configured via Settings UI (stored in PostgreSQL, takes precedence over env vars). See `.env.example` for full list.

## Issue Templates

When creating GitHub issues, follow the templates in `@docs/ai-instructions/issue-templates.md`.
