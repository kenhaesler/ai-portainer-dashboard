# Architecture Overview

Detailed directory structure and responsibilities for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Monorepo Structure

npm workspaces monorepo with 8 backend packages under `packages/` and a React frontend under `frontend/`.

```
packages/
├── contracts/       @dashboard/contracts       Shared interfaces + Zod schemas (zero impl)
├── core/            @dashboard/core            Kernel: DB, auth, config, Portainer API
├── ai-intelligence/ @dashboard/ai             LLM, prompt guard, anomaly detection, MCP
├── observability/   @dashboard/observability   Metrics, forecasting, traces, Prometheus
├── operations/      @dashboard/operations      Remediation, backup, webhooks, notifications
├── security/        @dashboard/security        Scanning, PCAP, Harbor, eBPF
├── infrastructure/  @dashboard/infrastructure  Edge agents, Docker logs, ELK
└── server/          @dashboard/server          App assembly, DI wiring, scheduler

backend/src/
├── routes/          14 foundational routes (auth, dashboard, containers, settings, etc.)
└── test/            Shared test utilities

frontend/src/
├── features/        Domain-specific pages, components, hooks
├── shared/          Reusable UI components, hooks, utilities
├── providers/       Context providers (auth, query, socket, theme, search)
└── stores/          Zustand state stores
```

## Dependency Graph

```
@dashboard/contracts  (foundation — zero deps except zod)
       ↑
@dashboard/core       (kernel — depends only on contracts + npm)
       ↑
@dashboard/infrastructure, @dashboard/observability,
@dashboard/security, @dashboard/operations
       ↑
@dashboard/ai         (imports ONLY core + contracts — never other domains)
       ↑
@dashboard/server     (composition root — wires all packages via DI)
```

Cross-domain communication is resolved via dependency injection in `packages/server/src/wiring.ts` — the **only file** that imports from all domain packages.

## Backend Packages (`packages/`)

### @dashboard/contracts — Shared Types

| Directory | Purpose |
|-----------|---------|
| `schemas/` | Zod schemas: container, endpoint, incident, insight, investigation, metric, remediation, security-finding |
| `interfaces/` | Service contracts: LLMInterface, MetricsInterface, InfrastructureLogsInterface, NotificationInterface, OperationsInterface, SecurityScannerInterface |
| `events.ts` | Typed event definitions for the event bus |

### @dashboard/core — Kernel

| Directory | Purpose |
|-----------|---------|
| `config/` | Env schema (Zod), validated config singleton |
| `db/` | PostgreSQL pools, adapter, migrations (postgres + timescale), test helpers |
| `utils/` | Logger (pino), crypto (JWT/bcrypt), log sanitizer, PII scrubber, network security, safe paths |
| `models/` | Zod schemas + TypeScript interfaces (auth, portainer, metrics, tracing, settings, etc.) |
| `plugins/` | Fastify plugins: auth, CORS, rate-limit, tracing, compression, Socket.IO, Swagger, security headers, cache control, static |
| `portainer/` | Portainer API client, Redis cache, normalizers (standard + edge), circuit breaker |
| `tracing/` | Distributed tracing context, span storage, OTLP export/transform |
| `services/` | Auth stores (session, user), settings, audit logger, typed event bus, OIDC |

### @dashboard/ai — AI Intelligence

| Directory | Purpose |
|-----------|---------|
| `routes/` | LLM query, LLM observability, feedback, monitoring, investigations, incidents, correlations, MCP, prompt profiles |
| `services/` | LLM client, prompt guard (3-layer), anomaly detector (statistical + isolation forest), monitoring orchestration, investigation, incident correlator, MCP manager |
| `sockets/` | `/llm` namespace (real-time chat), `/monitoring` namespace (real-time insights) |

### @dashboard/observability — Metrics & Traces

| Directory | Purpose |
|-----------|---------|
| `routes/` | Metrics query, forecasts, traces, traces-ingest (OTLP), Prometheus scrape, reports, status page |
| `services/` | Metrics store/collector, capacity forecaster, LTTB decimator, network rate tracker, KPI store, alert similarity, trace aggregation |

### @dashboard/operations — Remediation & Ops

| Directory | Purpose |
|-----------|---------|
| `routes/` | Remediation, backup, Portainer backup, logs, notifications, webhooks |
| `services/` | Remediation orchestrator, backup, notification, webhook dispatch, action history |
| `sockets/` | `/remediation` namespace (real-time action status) |

### @dashboard/security — Scanning & Compliance

| Directory | Purpose |
|-----------|---------|
| `routes/` | Harbor vulnerabilities, PCAP capture, eBPF coverage |
| `services/` | Security scanner, audit, Harbor client/sync, PCAP service/store/analysis, image staleness, eBPF coverage |

### @dashboard/infrastructure — Edge & Logs

| Directory | Purpose |
|-----------|---------|
| `routes/` | Edge job management |
| `services/` | Edge log fetcher (sync + async), capability guard, Docker frame decoder, Elasticsearch config/forwarder, Kibana client |

### @dashboard/server — Composition Root

| File | Purpose |
|------|---------|
| `app.ts` | Fastify factory — registers all plugins and routes |
| `wiring.ts` | DI wiring — builds adapters implementing contract interfaces |
| `scheduler.ts` | Background jobs: metrics (60s), monitoring (5min), daily cleanup |
| `socket-setup.ts` | Socket.IO namespace initialization |
| `index.ts` | Entry point — DB init, server start, graceful shutdown |

## Backend Routes (`backend/src/routes/`)

14 foundational routes not yet extracted to domain packages:

| Route | Purpose |
|-------|---------|
| `auth.ts` | Session auth (login, logout, refresh) |
| `oidc.ts` | OpenID Connect callback + token exchange |
| `health.ts` | Health + readiness endpoints |
| `dashboard.ts` | Dashboard aggregation view |
| `endpoints.ts` | Portainer endpoint proxy |
| `containers.ts` | Container list, inspect, actions |
| `container-logs.ts` | Container log streaming (sync + async) |
| `stacks.ts` | Docker Compose stack operations |
| `settings.ts` | Application settings CRUD |
| `images.ts` | Image management |
| `networks.ts` | Network topology |
| `search.ts` | Cross-resource search |
| `users.ts` | User management |
| `cache-admin.ts` | Redis cache admin |

## Frontend (`frontend/src/`) — React 19, TypeScript, Vite, Tailwind CSS v4

### Features (`features/`)

| Feature | Purpose |
|---------|---------|
| `core/` | Auth, login, settings, backups, post-login loading |
| `containers/` | Container explorer, detail, logs, topology graph, health comparison |
| `ai-intelligence/` | LLM assistant, AI monitor, investigation detail, LLM observability |
| `observability/` | Metrics dashboard, traces, logs, reports, status page |
| `operations/` | Remediation workflow, edge logs |
| `security/` | Security audit, vulnerabilities, packet capture, eBPF coverage |

Each feature contains: `pages/`, `components/`, `hooks/`, and optionally `lib/`.

### Shared (`shared/`)

| Directory | Purpose |
|-----------|---------|
| `components/` | Reusable UI: data tables, KPI cards, status badges, search bars, loading states |
| `components/charts/` | Recharts visualizations: line charts, sparklines, treemaps, pie charts, service maps |
| `components/icons/` | Icon sets, favicon manager, logos |
| `hooks/` | URL state, debounce, auto-refresh, keyboard shortcuts, page visibility, pull-to-refresh |
| `lib/api.ts` | Singleton API client with Bearer token + 401 auto-refresh |
| `lib/socket.ts` | Socket.IO client factory |
| `lib/motion-tokens.ts` | Framer Motion animation config (durations, easing, stagger) |

### Stores (`stores/`) — Zustand

| Store | Purpose | Persisted |
|-------|---------|-----------|
| `theme-store` | 16 themes, backgrounds, icon themes, favicon | Yes |
| `ui-store` | Sidebar, view modes, collapsed groups | Yes |
| `filter-store` | Endpoint + environment filters | Yes |
| `search-store` | Search history (max 6 recent) | Yes |
| `favorites-store` | Bookmarked containers/resources | Yes |
| `activity-feed-store` | Event stream, unread count (max 50) | No |
| `notification-store` | Toast queue | No |

### Providers

Composition order in `App.tsx`:
ThemeProvider > QueryProvider > AuthProvider > SocketProvider > SearchProvider > LazyMotion > RouterProvider

## Key Patterns

- **Observer-first**: Visibility prioritized; mutating actions require explicit approval via remediation workflow.
- **DI via wiring.ts**: Cross-domain dependencies resolved through contract interfaces — prevents circular imports.
- **AI isolation**: `@dashboard/ai` imports ONLY `core` + `contracts`. All other cross-domain data flows through DI adapters.
- **Barrel exports**: Each package has `index.ts` barrel. Routes NOT re-exported from barrel (import directly from `routes/index.js`).
- **Server state**: TanStack React Query. **UI state**: Zustand.
- **Zod validation** on all API boundaries (Portainer responses, request bodies, config).
- `PortainerError` with retry + exponential backoff + circuit breaker.
- Path alias `@/*` → `./src/*` in both workspaces.
- Vite proxies `/api` → `localhost:3051`, `/socket.io` → WebSocket.
- Lazy-loaded pages via `React.lazy()` + `Suspense` + `ChunkLoadErrorBoundary`.
