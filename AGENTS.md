# AGENTS.md

> **Keep in sync:** This file shares rules with `CLAUDE.md` and `GEMINI.md`. When updating mandatory rules, git workflow, or security requirements, apply the same change to all three files.

This file provides guidance to AI coding assistants working with this repository. All AI tools (GitHub Copilot, Cursor, Windsurf, Cody, etc.) MUST follow these guidelines.

## Project Overview

AI-powered container monitoring dashboard that extends Portainer with real-time insights, anomaly detection, and an LLM chat assistant. This is an **observer-first** dashboard — visibility comes first, but some actions can be triggered through an explicit approval workflow (e.g., remediation execution). Monorepo with npm workspaces: `backend/` (Fastify 5 + SQLite) and `frontend/` (React 19 + Vite).

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

### 2. Observer-First Constraint

This dashboard is primarily read-only, but it may trigger specific, explicitly approved actions via the remediation workflow. Do not add new container-mutating actions without an explicit request, and ensure all actions remain gated, auditable, and opt-in.

### 3. Never Push Directly to `main` or `dev`

This project uses a **two-tier branching model**: `feature/* → dev → main`. All changes go through feature branches and pull requests. Branch from `dev`, not `main`. Branch naming: `feature/<issue#>-<short-description>`.

### 4. Never Commit Secrets

No `.env` files, API keys, passwords, or credentials in commits.

### 5. Never Work on Issues Tagged `NO AI`

Do not pick up, implement, or modify code for any GitHub issue labeled `NO AI`. These issues are reserved for human developers only. If assigned or asked to work on a `NO AI` issue, refuse and explain that the issue is marked for human-only work.

### 6. Ask Before Assuming

If a request is ambiguous, under-specified, or could be interpreted in multiple ways, **stop and ask the user for clarification** before proceeding. Do not guess intent, pick a default approach silently, or make assumptions about scope. A quick clarifying question is always cheaper than reworking a wrong implementation.

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

# Bundle size check (runs after build, enforced in CI)
cd frontend && npx tsx scripts/check-bundle-size.ts

# Docker development (preferred)
docker compose -f docker/docker-compose.dev.yml up -d
```

## Local Runtime Dependencies

- **Docker runtime** — Required for `docker/docker-compose.dev.yml`. Backend and frontend run as containers.
- **Ollama** — LLM backend for AI features. Must be running externally (not bundled in Docker Compose). The default `OLLAMA_BASE_URL` is `http://host.docker.internal:11434`, which connects to Ollama running on the host machine.
- When running outside Docker (`npm run dev`), ensure Ollama is available at `OLLAMA_BASE_URL` (default `http://localhost:11434`) and Portainer at `PORTAINER_API_URL`.

## Architecture

### Backend (`backend/src/`)
Fastify 5, TypeScript, SQLite (better-sqlite3 with WAL mode), Socket.IO.

| Directory | Purpose |
|-----------|---------|
| `routes/` | REST API endpoints organized by feature (auth, containers, metrics, monitoring, etc.) |
| `services/` | Business logic: Portainer API client, anomaly detection (z-score), monitoring scheduler, hybrid cache (Redis + in-memory fallback) |
| `sockets/` | Socket.IO namespaces: `/llm` (chat), `/monitoring` (real-time insights), `/remediation` (action suggestions) |
| `models/` | Zod schemas for validation + database query functions |
| `db/migrations/` | SQLite migrations (auto-run on startup via `getDb()`) |
| `utils/` | Crypto (JWT/bcrypt), logging (Pino), shared helpers |
| `scheduler/` | Background jobs: metrics collection (60s), monitoring cycle (5min), daily cleanup |

### Frontend (`frontend/src/`)
React 19, TypeScript, Vite, Tailwind CSS v4.

| Directory | Purpose |
|-----------|---------|
| `pages/` | Lazy-loaded page components (18 pages, all wrapped in Suspense) |
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
- Frontend proxy: Vite dev server proxies `/api` to `localhost:3051` and `/socket.io` to WebSocket.
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

### Security Regression Tests
- `backend/src/routes/security-regression.test.ts` — centralized security test suite (36 tests)
- **Auth Enforcement Sweep**: Dynamically discovers all routes and verifies no `/api/*` route returns 2xx without auth
- **Prompt Injection Vectors**: 22 tests against LLM query endpoint (system prompt extraction, ignore-instructions, case variations)
- **False Positive Checks**: 8 tests ensuring benign dashboard queries are not blocked by the injection guard
- **Rate Limiting**: Verifies `LOGIN_RATE_LIMIT` enforcement and `retry-after` header presence

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

Each theme defines: semantic colors, sidebar colors, 5 chart colors, border radius, and spacing tokens. Theme transitions should be smooth (300ms on color/background properties).

### Dashboard Background (Animated)
Configurable animated gradient mesh background with optional floating particles, stored in Zustand (`theme-store.ts`). Three modes: `none`, `gradient-mesh`, `gradient-mesh-particles`. Configured in Settings > Appearance.

**Key files:**
- `frontend/src/components/layout/dashboard-background.tsx` — Renders the `fixed inset-0 z-0` gradient mesh + particles
- `frontend/src/stores/theme-store.ts` — `DashboardBackground` type, `dashboardBackgroundOptions`, store state
- `frontend/src/index.css` — Glass override rules (search for `ANIMATED BACKGROUND`)

**Glass override pattern:** When background is active, sidebar, header, activity feed, and content elements (cards, inputs, tables) become translucent. This uses `data-animated-bg` HTML attributes and CSS `color-mix(in srgb, var(...) 35%, transparent)` with `!important` to override Apple theme rules. The override rules **must** come AFTER Apple theme rules in `index.css` to win the specificity battle. Apple theme `& nav` rules exclude `aside nav` via `:not(aside nav)` to prevent double-background on the sidebar's inner nav element.

### Layout Patterns
- **Bento grids** for dashboards — `auto-rows-[minmax(180px,1fr)]` with 1-4 column responsive grid
- **Hero cards** span 2 columns for primary KPIs with animated counters
- **Compact sparklines** in KPI cards for trend visualization
- **Sidebar** — Collapsible (60px collapsed / 16rem expanded), glassmorphic background, 4 logical navigation groups, hidden scrollbar (thin on hover)
- **Header** — Fixed top bar with breadcrumbs, command palette trigger (Ctrl+K), theme toggle, user menu
- **Activity Feed** — Fixed bottom bar with real-time events, expandable (max-h-64), translucent with animated background
- **Dashboard Background** — Optional `fixed inset-0 z-0` gradient mesh reusing login page CSS animations, configurable in settings

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
- **Document all changes** — Every feature implementation must include documentation updates in the same PR. Update `docs/architecture.md` (route table, project structure, Mermaid diagrams), `.env.example` (new env vars), and `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` (new build commands or workflow rules). Do not merge code without corresponding docs.
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
- **Always link PRs to their underlying issue.** When creating a PR, use `Closes #<issue>` in the PR body or pass `--body "Closes #<issue>"` with `gh pr create` so GitHub links the PR to the issue.
- **Only merge a PR when all CI checks pass.** Never merge with failing checks. After a PR is merged, manually close the linked issue (for example, `gh issue close <issue-number>`). Do not rely on `Closes #<issue>` to auto-close issues.
- **If a CI check fails, investigate and fix the underlying issue.** Do not ignore or dismiss failing checks. Read the CI output, identify the root cause, fix the code, and push a new commit to make the checks pass before proceeding.

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:
- `PORTAINER_API_URL` / `PORTAINER_API_KEY` — Required for Portainer connection
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — Login credentials
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` — LLM config (defaults: `http://host.docker.internal:11434`, `llama3.2`)
- `REDIS_URL` / `REDIS_KEY_PREFIX` — Hybrid cache backend config (defaults: `redis://redis:6379`, `aidash:cache:`)
- `JWT_SECRET` — Must be 32+ chars in production
- See `.env.example` for the full list including OIDC, monitoring, caching, and rate-limit settings.

---

## Creating GitHub Issues

This project uses specific issue formats. When asked to create issues, follow these templates exactly.

### Available Labels

| Label | Use When |
|-------|----------|
| `enhancement` | New feature or improvement |
| `bug` | Something is broken |
| `UI` | Involves frontend/visual changes |
| `security` | Security-related issue |
| `needs-refinement` | Requires more research or design before implementation |
| `needs-discussion` | Needs team discussion before committing to approach |
| `documentation` | Docs-only change |

### CLI Commands

```bash
# Feature issue
gh issue create \
  --title "Feature: <Short Descriptive Title>" \
  --label "enhancement" \
  --label "needs-refinement" \
  --body "$(cat <<'EOF'
<body here>
EOF
)"

# Bug issue
gh issue create \
  --title "<Descriptive problem summary>" \
  --label "bug" \
  --body "$(cat <<'EOF'
<body here>
EOF
)"
```

---

### Feature Issue Template

**Title format:** `Feature: <Descriptive Name>`

**Labels:** Always `enhancement`. Add `needs-refinement` if research/design questions remain. Add `needs-discussion` if the approach is experimental or controversial. Add `UI` if it involves frontend/visual work.

**Body structure (follow this order exactly):**

```markdown
## Problem Statement

<1-2 paragraphs explaining WHY this feature is needed. Describe the current gap
or pain point. Use concrete examples of what users can't do today. Reference
competitor tools or industry standards if relevant.>

## Proposed Solution

<Overview paragraph of the approach.>

### <Sub-section for each major component>

<Use TABLES for feature lists, shortcuts, patterns, or any structured data:>

| Feature | Description |
|---------|-------------|
| **Feature name** | What it does |

<Use ASCII ART MOCKUPS for UI features:>

```
┌─ Component Name ─────────────────────────────────────┐
│ [UI mockup showing layout and key elements]           │
│                                                       │
│ Show data flow, user interactions, visual layout      │
└───────────────────────────────────────────────────────┘
```

<Use CODE BLOCKS for algorithms, formulas, or config examples.>

## Use Cases

1. **Use case name**: Concrete scenario with specific container/service names
2. **Use case name**: Another scenario showing different value
3. **Use case name**: Edge case or advanced usage

## Acceptance Criteria

- [ ] <Specific, testable requirement>
- [ ] <Another requirement — be precise about behavior>
- [ ] <Include both backend AND frontend criteria>
- [ ] <Include test requirements>
- [ ] <Include theme/design consistency for UI features>

## Technical Considerations

- <Architecture: which files/modules are affected>
- <Dependencies: new libraries or existing ones to extend>
- <Performance: complexity, caching, real-time needs>
- <Storage: database changes, new tables or fields>
- <Observer-only: confirm read-only access if relevant>
- <Integration: how it connects to existing features>

**Effort Estimate:** 🟢 Small | 🟡 Medium | 🟠 Large | 🔴 Very Large
**Impact Estimate:** 🟢 Low | 🟡 High | 🔴 Very High
**Priority Score:** X.X/10

> **Needs Refinement**: <Open questions, research needed, or decisions
> required before implementation. Only include when labeled `needs-refinement`.>
```

**Feature content rules:**
1. Problem Statement must explain the "why" — not just "we should add X" but "users can't do Y, causing Z"
2. Use **tables** for structured data (features, shortcuts, patterns)
3. Use **ASCII mockups** for any UI feature — show the layout
4. Acceptance criteria must be **checkbox items**, each specific and testable
5. Technical considerations must **reference actual files** in this codebase
6. Priority scores use X.X/10 scale based on effort vs. impact
7. Reference related issues with `#number`

---

### Bug Issue Template

**Title format:** Descriptive problem statement (NO "Bug:" prefix). State what's wrong clearly.

**Labels:** Always `bug`. Add `UI` for visual bugs. Add `security` for security issues. Add `enhancement` if the fix also improves behavior.

**Body structure (follow this order exactly):**

```markdown
## Summary

<1-2 sentences describing the bug concisely.>

## Root Cause

<If known, explain WHY the bug happens. Reference specific files and line numbers:>

In `path/to/file.ts` line XX:

```typescript
// Show the problematic code
```

<Explain what this code does wrong.>

## Issues

<If there are MULTIPLE related bugs, number them:>

### 1. <First bug>
<Description with file references and code snippets>

### 2. <Second bug>
<Description with file references and code snippets>

<If it's a SINGLE bug, skip numbered sub-sections — just use Summary + Root Cause.>

## Steps to Reproduce

1. <Specific step>
2. <Specific step>
3. Observe: <what you see>

## Expected Behavior

<What should happen instead.>

## Actual Behavior

<What actually happens. Include error messages or logs if relevant.>

## Fix Approach

<If the fix is known, outline the steps:>

1. <Step — reference specific files>
2. <Step>
3. <Step>

## Relevant Files

- `path/to/file.ts` — What's in this file and why it matters (line XX)
- `path/to/another.ts` — Why this file is relevant
```

**Bug content rules:**
1. Always include **file paths** where the bug exists
2. Include **line numbers** when possible
3. Show **problematic code** in fenced code blocks with language annotation
4. Explain the **root cause** (why), not just symptoms (what)
5. Fix approach is optional but encouraged when the solution is clear
6. Steps to reproduce must be **numbered** and specific

---

### General Issue Rules

1. Use **GitHub-flavored markdown** — headers, tables, code blocks, checkboxes, blockquotes
2. Reference existing issues with `#number` when related
3. Reference **actual file paths** in the codebase — do not invent paths
4. Respect the **observer-only constraint** — never propose features that mutate container state
5. Be **specific** — every issue must have enough detail for someone to start implementation
6. **One concern per issue** — unless bugs are tightly related (same page/component)
7. **No duplicates** — check existing issues with `gh issue list --state open` before creating
