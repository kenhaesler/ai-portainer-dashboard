# AGENTS.md

This file provides guidance to AI coding assistants working with this repository. All AI tools (GitHub Copilot, Cursor, Windsurf, Cody, etc.) MUST follow these guidelines.

## Project Overview

AI-powered container monitoring dashboard that extends Portainer with real-time insights, anomaly detection, and an LLM chat assistant. This is an **observer-only** dashboard — it does not start, stop, or restart containers. Monorepo with npm workspaces: `backend/` (Fastify 5 + SQLite) and `frontend/` (React 19 + Vite).

## Mandatory Rules — Read First

### 1. Testing Is Required — No Exceptions

**Every code change MUST include tests before it can be merged to `main`.** This is enforced by CI and is non-negotiable.

- All new features MUST have corresponding unit and/or integration tests
- All bug fixes MUST have a regression test proving the fix
- All modified behavior MUST have updated tests reflecting the change
- PRs without tests WILL be blocked by CI — do not attempt to bypass this
- Never use `--no-verify`, skip hooks, or circumvent test requirements
- If you cannot write tests for a change, stop and explain why before proceeding
- Backend tests: `backend/src/**/*.test.ts` — Frontend tests: `frontend/src/**/*.test.{ts,tsx}`
- Both workspaces use Vitest. Frontend tests use jsdom environment with `@testing-library/react`
- **Test before committing. Test before pushing. Test before creating a PR.**
- **DO NOT create pull requests without passing tests. CI will reject them.**

### 2. Observer-Only Constraint

This dashboard MUST NOT generate code that starts, stops, restarts, or otherwise mutates container state. Read-only access to Portainer only.

### 3. Never Push Directly to `main` or `dev`

This project uses a **two-tier branching model**: `feature/* → dev → main`. All changes go through feature branches and pull requests. Branch from `dev`, not `main`. Branch naming: `feature/<issue#>-<short-description>`.

### 4. Never Commit Secrets

No `.env` files, API keys, passwords, or credentials in commits.

## Build & Development Commands

```bash
npm install                # Install all dependencies (both workspaces)
npm run dev                # Development (runs backend + frontend concurrently)
npm run build              # Build everything
npm run lint               # Lint
npm run typecheck          # Type check
npm test                   # Run all tests
npm run test -w backend    # Tests for backend only
npm run test -w frontend   # Tests for frontend only
npm run test:watch         # Watch mode

# Single test file
npx vitest run src/utils/crypto.test.ts --config backend/vitest.config.ts
npx vitest run src/lib/utils.test.ts --config frontend/vitest.config.ts

# Docker development (preferred — includes Ollama)
docker compose -f docker-compose.dev.yml up -d
```

## Architecture

### Backend (`backend/src/`)
Fastify 5, TypeScript, SQLite (better-sqlite3 with WAL mode), Socket.IO.

| Directory | Purpose |
|-----------|---------|
| `routes/` | REST API endpoints organized by feature (auth, containers, metrics, monitoring, etc.) |
| `services/` | Business logic: Portainer API client, anomaly detection (z-score), monitoring scheduler |
| `sockets/` | Socket.IO namespaces: `/llm` (chat), `/monitoring` (real-time insights), `/remediation` (action suggestions) |
| `models/` | Zod schemas for validation + database query functions |
| `db/migrations/` | SQLite migrations (auto-run on startup via `getDb()`) |
| `utils/` | Crypto (JWT/bcrypt), logging (Pino), config, caching |
| `scheduler/` | Background jobs: metrics collection (60s), monitoring cycle (5min), daily cleanup |

### Frontend (`frontend/src/`)
React 19, TypeScript, Vite, Tailwind CSS v4.

| Directory | Purpose |
|-----------|---------|
| `pages/` | Lazy-loaded page components (17 pages, all wrapped in Suspense) |
| `components/` | Organized by domain: `layout/`, `charts/`, `shared/`, `container/`, `network/` |
| `hooks/` | Data-fetching hooks wrapping TanStack React Query |
| `stores/` | Zustand stores for UI state (theme, sidebar, notifications, filters) |
| `providers/` | Context providers for auth, theme, Socket.IO, React Query |
| `lib/api.ts` | Singleton API client with auto-refresh on 401 |

### Key Patterns

- **Server state**: TanStack React Query. **UI state**: Zustand.
- All Portainer API responses validated with Zod schemas.
- Path alias `@/*` maps to `./src/*` in both workspaces.
- Custom error class `PortainerError` with retry logic and exponential backoff.
- Frontend proxy: Vite dev server proxies `/api` to `localhost:3001` and `/socket.io` to WebSocket.
- Provider hierarchy: ThemeProvider > QueryProvider > AuthProvider > SocketProvider > RouterProvider

## Security Requirements

All code changes must follow these security rules. Violations block PRs.

### Authentication & Authorization
- JWT tokens use `jose` library with strong secrets (32+ characters in production)
- Session store backed by SQLite — tokens are validated server-side on every request
- OIDC/SSO integration via `openid-client` v6 — PKCE required for all authorization code flows
- Rate limiting enforced on login endpoints (configurable via `LOGIN_RATE_LIMIT`)
- Auth plugin decorates `fastify.authenticate` — all protected routes must use this decorator

### Input Validation & Injection Prevention
- All API inputs validated with Zod schemas at the route level — no unvalidated user data reaches services
- Use parameterized queries only — never concatenate user input into SQL strings
- Sanitize all user-provided content rendered in the frontend to prevent XSS
- Content Security Policy headers should be configured for production deployments
- Never use `dangerouslySetInnerHTML` unless content is sanitized with a trusted library

### Secrets & Credentials
- Never commit `.env`, credentials, API keys, or passwords
- Never log secrets, tokens, or passwords — even at debug level
- All sensitive config must come from environment variables
- Frontend must never contain or expose backend secrets

### Dependency Security
- Keep dependencies updated — check for known vulnerabilities
- Never add dependencies with known CVEs
- Prefer well-maintained, widely-used libraries over obscure alternatives
- Lock file (`package-lock.json`) must be committed and kept in sync

### Network Security
- All external API calls (Portainer, Ollama) should respect `PORTAINER_VERIFY_SSL` setting
- WebSocket connections authenticated via the same JWT mechanism as REST
- CORS configured via `@fastify/cors` — do not use wildcard origins in production

## UI/UX Design Vision

This dashboard aims for a **state-of-the-art, premium visual experience** that creates immediate "wow" impact while maintaining exceptional usability. Every UI change should move toward this vision.

### Design Principles
1. **Visual hierarchy through layout** — Use bento grid layouts with varied card sizes to naturally guide the eye from hero KPIs to supporting data
2. **Depth and dimension** — Glassmorphic cards with backdrop blur, subtle shadows, and hover lift effects create a layered, tactile interface
3. **Motion with purpose** — Every animation must serve a function: page transitions orient the user, staggered entrances reveal information hierarchy, micro-interactions confirm actions
4. **Progressive disclosure** — Show the most important information first, reveal details on interaction. Skeleton loaders should mirror the actual component layout
5. **Accessible beauty** — All glass effects must maintain WCAG AA contrast ratios. Respect `prefers-reduced-motion` and `prefers-reduced-transparency`. Beauty never comes at the cost of usability

### Technology Stack for UI
- **Tailwind CSS v4** — CSS variables for theming, container queries, 3D transforms, OKLCH gradients, `@starting-style` for entry animations
- **Motion (Framer Motion)** — Page transitions via `AnimatePresence`, staggered list animations, spring-based hover/tap interactions, scroll-triggered reveals. Use `LazyMotion` for bundle optimization
- **Recharts** — Area charts with gradient fills, glass-styled custom tooltips, CSS variable colors, animated data transitions
- **Radix UI** — Unstyled accessibility primitives for dialogs, dropdowns, tabs, tooltips

### Theme System
9 themes defined via CSS custom properties in `index.css`:
- Default light/dark
- Apple Light/Dark (glassmorphism with backdrop blur + gradient mesh backgrounds)
- Catppuccin Latte/Frappe/Macchiato/Mocha (warm pastel palette family)

### Layout Patterns
- **Bento grids** for dashboards — `auto-rows-[minmax(180px,1fr)]` with 1-4 column responsive grid
- **Hero cards** span 2 columns for primary KPIs with animated counters
- **Compact sparklines** in KPI cards for trend visualization
- **Sidebar** — Collapsible (60px collapsed / 16rem expanded), glassmorphic background, 4 navigation groups
- **Header** — Fixed top bar with breadcrumbs, command palette trigger (Ctrl+K), theme toggle, user menu

### Animation Standards
- **Durations**: 150ms (micro-interactions), 250ms (state changes), 400ms (page transitions)
- **Easing**: `cubic-bezier(0.32, 0.72, 0, 1)` for entrances, spring physics for interactive elements
- **Stagger**: 40-80ms between children in lists/grids
- **GPU-only properties**: Animate only `transform` and `opacity` for 60fps performance
- **Accessibility**: All animations wrapped in `reducedMotion="user"` via `MotionConfig`

### Status Color System (Industry Standard)
```
Green  (emerald-500): Healthy, running, success
Yellow (yellow-500):  Warning, degraded, high utilization
Orange (orange-500):  Critical warning, approaching limit
Red    (red-500):     Error, down, failed, anomaly
Blue   (blue-500):    Informational, deploying, processing
Gray   (gray-500):    Unknown, stopped, inactive
Purple (purple-500):  AI-generated insight, recommendation
```

## Code Quality Standards

- **Readability first** — Clear naming, logical grouping, consistent formatting. Prefer explicit over clever.
- **Document all changes** — Update relevant documentation when behavior changes.
- **Test coverage required** — See "Mandatory Rules" section above. This is non-negotiable.
- ESLint config is in each workspace's `eslint.config.js`. TypeScript strict mode is on in both.
- Do not add unnecessary abstractions, over-engineer, or add features beyond what is requested.

## Git Workflow

This project uses a **two-tier branching model**: `feature/* → dev → main`.

```
main          ← stable/release (protected)
 └── dev      ← integration branch (protected)
      └── feature/<issue#>-<desc>  ← your work here
```

- **Never push directly to `main` or `dev`.** All changes go through feature branches and pull requests.
- **`dev`** is the integration branch where all feature work lands first.
- **`main`** is the stable/release branch. Only `dev` merges into `main`.
- Create feature branches from `dev`: `feature/<issue#>-<short-description>`.
- When a feature is complete, open a PR from `feature/*` → `dev`. CI must pass (typecheck → lint → test → build).
- When `dev` is stable and ready for release, open a PR from `dev` → `main`. If all CI checks pass, the merge is approved.
- Commit messages should be concise and describe the "why" not just the "what".
- **PRs without passing tests will be automatically blocked. Do not create PRs without tests.**

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:
- `PORTAINER_API_URL` / `PORTAINER_API_KEY` — Required for Portainer connection
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — Login credentials
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` — LLM config (defaults: `http://ollama:11434`, `llama3.2`)
- `JWT_SECRET` — Must be 32+ chars in production
- See `.env.example` for the full list including OIDC, monitoring, caching, and rate-limit settings.
