# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. AGENTS.md and GEMINI.md mirror these rules for other AI tools.

## Project Overview

AI-powered container monitoring dashboard extending Portainer with real-time insights, anomaly detection, and an LLM chat assistant. **Observer-first** — visibility comes first; actions require explicit approval via remediation workflow. Monorepo: `backend/` (Fastify 5 + SQLite) and `frontend/` (React 19 + Vite).

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
# Single file: npx vitest run src/path/file.test.ts --config backend/vitest.config.ts
# E2E: npx playwright test (requires running backend + frontend)
# Docker: docker compose -f docker/docker-compose.dev.yml up -d
```

## Architecture

### Backend (`backend/src/`) — Fastify 5, TypeScript, SQLite (WAL), Socket.IO

| Directory | Purpose |
|-----------|---------|
| `routes/` | REST API endpoints by feature (auth, containers, metrics, monitoring) |
| `services/` | Portainer client, anomaly detection (z-score), monitoring, hybrid cache (Redis + in-memory) |
| `sockets/` | Socket.IO: `/llm` (chat), `/monitoring` (insights), `/remediation` (actions) |
| `models/` | Zod schemas + database query functions |
| `db/migrations/` | SQLite migrations (auto-run via `getDb()`) |
| `scheduler/` | Background: metrics (60s), monitoring (5min), daily cleanup |

### Frontend (`frontend/src/`) — React 19, TypeScript, Vite, Tailwind CSS v4

| Directory | Purpose |
|-----------|---------|
| `pages/` | 18 lazy-loaded pages (Suspense-wrapped) |
| `components/` | By domain: `layout/`, `charts/`, `shared/`, `container/`, `network/` |
| `hooks/` | TanStack React Query wrappers |
| `stores/` | Zustand stores (theme, sidebar, notifications, filters) |
| `providers/` | Auth, theme, Socket.IO, React Query providers |
| `lib/api.ts` | Singleton API client with 401 auto-refresh |

### Key Patterns

- **Server state**: TanStack React Query. **UI state**: Zustand.
- Zod validation on all Portainer API responses.
- Path alias `@/*` → `./src/*` in both workspaces.
- `PortainerError` with retry + exponential backoff.
- Vite proxies `/api` → `localhost:3051`, `/socket.io` → WebSocket.
- Providers: ThemeProvider > QueryProvider > AuthProvider > SocketProvider > RouterProvider.

## Security (Project-Specific)

- JWT via `jose` (32+ char secrets). Session store in SQLite — validated server-side per request.
- OIDC/SSO via `openid-client` v6 with PKCE. Rate limiting on login (`LOGIN_RATE_LIMIT`).
- Auth decorator: `fastify.authenticate` on all protected routes.
- **Prompt injection guard** (`services/prompt-guard.ts`): 3-layer (regex 25+, heuristic scoring, output sanitization). Applied to REST `/api/llm/query` and WebSocket `chat:message`. Configurable: `LLM_PROMPT_GUARD_STRICT`.
- Security regression tests: `backend/src/routes/security-regression.test.ts` (36 tests — auth sweep, prompt injection, false positives, rate limiting).
- For the full checklist, see `@docs/ai-instructions/security-checklist.md`.

## UI/UX Design

Premium glassmorphic dashboard: bento grids, backdrop blur cards, staggered animations, 9 themes (light/dark, Apple, Catppuccin family). Motion via Framer Motion (`LazyMotion`), charts via Recharts, primitives via Radix UI. Animated gradient mesh background (configurable). All animations respect `prefers-reduced-motion`.

**Status colors:** Green=healthy, Yellow=warning, Orange=critical, Red=error, Blue=info, Gray=inactive, Purple=AI insight.

For detailed specs (animation durations, easing curves, glass override patterns, layout patterns), see `@docs/ai-instructions/ui-design-system.md`.

## Code Quality

- Readability first. Explicit over clever.
- Every PR must include doc updates: `docs/architecture.md`, `.env.example`, and this file.
- ESLint in each workspace. TypeScript strict mode. No over-engineering.

## Git Workflow

```
main ← stable/release (protected)
 └── dev ← integration (protected)
      └── feature/<issue#>-<desc> ← your work
```

- PRs: `feature/* → dev` (CI: typecheck → lint → test → build). `dev → main` for releases.
- Always link PRs to issues (`Closes #<issue>`). After merge, manually close the issue.
- If CI fails, fix the root cause — never ignore or dismiss failing checks.
- Commits: concise, describe "why" not "what".

## Environment

Copy `.env.example` to `.env`. Key vars: `PORTAINER_API_URL`, `PORTAINER_API_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `OLLAMA_BASE_URL` (default `http://host.docker.internal:11434`), `OLLAMA_MODEL` (default `llama3.2`), `REDIS_URL`, `JWT_SECRET` (32+ chars). See `.env.example` for full list.

## Issue Templates

When creating GitHub issues, follow the templates in `@docs/ai-instructions/issue-templates.md`.
