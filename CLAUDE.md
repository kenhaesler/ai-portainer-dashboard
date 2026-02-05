# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered container monitoring dashboard that extends Portainer with real-time insights, anomaly detection, and an LLM chat assistant. This is an **observer-only** dashboard — it does not start, stop, or restart containers. Monorepo with npm workspaces: `backend/` (Fastify 5 + SQLite) and `frontend/` (React 19 + Vite).

## Build & Development Commands

```bash
# Install all dependencies (both workspaces)
npm install

# Development (runs both backend and frontend concurrently)
npm run dev

# Or via Docker (preferred — includes Ollama for AI features)
docker compose -f docker-compose.dev.yml up -d

# Build everything
npm run build

# Lint
npm run lint

# Type check
npm run typecheck

# Run all tests
npm test

# Run tests for a single workspace
npm run test -w backend
npm run test -w frontend

# Run a single test file
npx vitest run src/utils/crypto.test.ts --config backend/vitest.config.ts
npx vitest run src/lib/utils.test.ts --config frontend/vitest.config.ts

# Watch mode
npm run test:watch
```

## Local Runtime Dependencies

During development, the app depends on **local Docker** and **Ollama** for full functionality:

- **Docker runtime** — Required for running the app via `docker-compose.dev.yml`. Backend, frontend, and Ollama all run as containers. The Portainer instance being monitored may also be local.
- **Ollama** — Provides the LLM backend for AI features (chat, insights, anomaly analysis). Runs as a container in the dev compose stack on port 11434. Pull the model with: `docker compose -f docker-compose.dev.yml exec ollama ollama pull llama3.2`
- When running outside Docker (`npm run dev`), ensure Ollama is available at `OLLAMA_BASE_URL` (default `http://localhost:11434`) and Portainer at `PORTAINER_API_URL`.

## Architecture

**Backend** (`backend/src/`): Fastify 5, TypeScript, SQLite (better-sqlite3 with WAL mode), Socket.IO.
- `routes/` — REST API endpoints organized by feature (auth, containers, metrics, monitoring, etc.)
- `services/` — Business logic: Portainer API client, anomaly detection (z-score), monitoring scheduler
- `sockets/` — Socket.IO namespaces: `/llm` (chat), `/monitoring` (real-time insights), `/remediation` (action suggestions)
- `models/` — Zod schemas for validation + database query functions
- `db/migrations/` — SQLite migrations (auto-run on startup via `getDb()`)
- `utils/` — Crypto (JWT/bcrypt), logging (Pino), config, caching
- `scheduler/` — Background jobs: metrics collection (60s), monitoring cycle (5min), daily cleanup

**Frontend** (`frontend/src/`): React 19, TypeScript, Vite, Tailwind CSS v4.
- `pages/` — Lazy-loaded page components (16 pages, all wrapped in Suspense)
- `components/` — Organized by domain: `layout/`, `charts/`, `shared/`, `container/`, `network/`
- `hooks/` — Data-fetching hooks wrapping TanStack React Query
- `stores/` — Zustand stores for UI state (theme, sidebar, notifications, filters)
- `providers/` — Context providers for auth, theme, Socket.IO, React Query
- `lib/api.ts` — Singleton API client with auto-refresh on 401

**Key patterns:**
- Server state: TanStack React Query. UI state: Zustand.
- All Portainer API responses validated with Zod schemas.
- Path alias `@/*` maps to `./src/*` in both workspaces.
- Custom error class `PortainerError` with retry logic and exponential backoff.
- Frontend proxy: Vite dev server proxies `/api` → `localhost:3001` and `/socket.io` → WebSocket.

## Git Workflow

- **Never push directly to `main`.** All changes must go through feature branches and pull requests.
- Create feature branches from `main` using descriptive names: `feature/<issue#>-<short-description>` (e.g., `feature/42-add-log-export`).
- CI runs on PRs: typecheck → lint → test → build (see `.github/workflows/ci.yml`).
- Commit messages should be concise and describe the "why" not just the "what".

## Code Quality Standards

- **Readability first** — Code should be well-structured with clear naming, logical grouping, and consistent formatting. Prefer explicit over clever.
- **Document all changes** — Update relevant documentation (README, inline comments, JSDoc for public APIs) when behavior changes. If a feature is added or modified, its documentation must be updated in the same PR.
- **Test coverage required** — All new features and bug fixes must include corresponding unit and/or integration tests. Update existing tests when modifying behavior. Backend tests go in `backend/src/**/*.test.ts`, frontend tests in `frontend/src/**/*.test.{ts,tsx}`.
- Both workspaces use Vitest. Frontend tests use jsdom environment with `@testing-library/react`.
- ESLint config is in each workspace's `eslint.config.js`. TypeScript strict mode is on in both.

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:
- `PORTAINER_API_URL` / `PORTAINER_API_KEY` — Required for Portainer connection
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — Login credentials
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` — LLM config (defaults: `http://ollama:11434`, `llama3.2`)
- `JWT_SECRET` — Must be 32+ chars in production
- See `.env.example` for the full list including monitoring, caching, and rate-limit settings.
