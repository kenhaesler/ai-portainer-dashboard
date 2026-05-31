# Architecture Overview

Detailed directory structure and responsibilities for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Monorepo Structure

npm workspaces monorepo with 9 backend packages under `packages/` and a React frontend under `frontend/`.

```
packages/
├── contracts/       @dashboard/contracts       Shared interfaces + Zod schemas (zero impl)
├── core/            @dashboard/core            Kernel: DB, auth, config, Portainer API
├── ai-intelligence/ @dashboard/ai             LLM, prompt guard, anomaly detection, MCP
├── observability/   @dashboard/observability   Metrics, forecasting, traces, Prometheus
├── operations/      @dashboard/operations      Remediation, backup, webhooks, notifications
├── security/        @dashboard/security        Scanning, PCAP, Harbor, eBPF
├── infrastructure/  @dashboard/infrastructure  Edge agents, Docker logs, ELK
├── foundation/      @dashboard/foundation      Foundational routes (auth, containers, settings, etc.)
└── server/          @dashboard/server          App assembly, DI wiring, scheduler

backend/src/
├── routes/          Tests for foundational routes (source now in @dashboard/foundation)
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
@dashboard/foundation (foundational routes — imports core, contracts, ai, observability, security)
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
| `services/` | Auth stores (session, user), global + per-user settings (`user_settings` k/v from migration 036), audit logger, typed event bus, OIDC |

### @dashboard/ai — AI Intelligence

| Directory | Purpose |
|-----------|---------|
| `routes/` | LLM query, LLM observability, feedback, monitoring (incl. per-user `/api/monitoring/sensitivity` GET/PUT — #1297, anomaly-feedback false-positive loop — #1298), investigations, incidents, correlations, MCP, prompt profiles |
| `services/` | LLM client, prompt guard (3-layer), anomaly detector (statistical + isolation forest), sensitivity preset (per-user post-filter, #1297), monitoring orchestration, investigation, incident correlator, MCP manager |
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
| `scheduler.ts` | Background jobs: metrics, monitoring, webhook retry, cleanup, etc. (see [Background Scheduler](#background-scheduler)) |
| `socket-setup.ts` | Socket.IO namespace initialization |
| `index.ts` | Entry point — DB init, server start, graceful shutdown |

### @dashboard/foundation — Foundational Routes

15 cross-domain routes tightly coupled to the Portainer API and core services, extracted from `backend/src/routes/`:

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
| `kubernetes.ts` | Kubernetes endpoint support |

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
| `notification-store` | Toast queue | No |

### Providers

Composition order in `App.tsx`:
ThemeProvider > QueryProvider > AuthProvider > SocketProvider > SearchProvider > LazyMotion > RouterProvider

## Caching model

```
[Portainer API]  →  [Server cache (Redis)]  →  [React Query]  →  [UI]
```

- The **server cache** is a Redis-backed layer in front of Portainer. Auto-refresh intervals, React Query background revalidation, and cross-panel re-renders read from it so the upstream Portainer API isn't hammered on every poll.
- The **explicit Refresh button** (`frontend/src/shared/components/ui/refresh-button.tsx`) treats a user click as a foreground freshness signal: it invalidates the server cache for the active resource via `POST /api/admin/cache/invalidate?resource=…` and then re-fetches. `useForceRefresh` (`frontend/src/shared/hooks/use-force-refresh.ts`) swallows the 403 non-admins get from the admin-only invalidate endpoint and falls through to a plain refetch — non-admins keep working, no error toast.
- The invalidate endpoint is admin-only (`packages/foundation/src/routes/cache-admin.ts`). Cache TTLs, keys, and invalidation patterns belong to the kernel (`packages/core/src/portainer/`).

## Database Schema

The backend uses **two PostgreSQL databases** managed by sequential SQL migrations in `packages/core/src/db/`:

- **App DB** (`postgres-migrations/`, currently 37 migrations) — all relational application state.
- **Metrics DB** (`timescale-migrations/`) — a TimescaleDB instance holding time-series metrics in hypertables.

Metrics are dual-written: every collected sample lands in the app DB `metrics` table (for direct lookups) **and** the TimescaleDB `metrics` hypertable (for time-series rollups). Migrations run automatically on startup.

### App database (PostgreSQL)

| Table(s) | Purpose |
|----------|---------|
| `sessions` | Server-side auth sessions (token hash, expiry, validity) — validated per request |
| `users` | Local accounts with RBAC `role` (`viewer` / `operator` / `admin`) + default landing page |
| `oidc_user_groups` | OIDC group claims observed at login (migration 034) |
| `settings` | Global key/value app configuration, categorized |
| `user_settings` | **Per-user** preferences keyed by `(user_id, key)` — e.g. anomaly sensitivity (migration 036) |
| `insights` | Detected anomalies/findings (severity, category, structured dimensions, acknowledged flag) |
| `incidents` | Correlated insight groups (root-cause insight, `signature` for dedup rollup, affected containers) |
| `investigations` | LLM root-cause analyses linked to a triggering insight |
| `actions` | Remediation action queue + audit trail (`pending`→`approved`→`executing`→`completed`/`failed`) |
| `anomaly_feedback` | Per-user false-positive dispositions, unique on `(anomaly_id, user_id)` (migration 037, #1298) |
| `monitoring_cycles` / `monitoring_snapshots` | Monitoring run telemetry + fleet snapshots |
| `monitoring_dedup_metrics` | Per-signature alert-volume telemetry for tuning (migration 033) |
| `spans` | Distributed trace spans (OTLP) with container / k8s attributes |
| `llm_traces` | LLM request/response telemetry (tokens, latency, model, status) |
| `llm_feedback` / `llm_prompt_suggestions` | LLM output ratings + suggested prompt edits |
| `prompt_profiles` / prompt versions | Built-in + custom system-prompt profiles and version history |
| `mcp_servers` | MCP tool-bridge server configurations |
| `webhooks` / `webhook_deliveries` | Outbound webhook definitions + delivery attempts/retries |
| `notification_log` | Notification delivery history (email/Teams/Discord/Telegram) |
| `harbor_vulnerabilities` / `harbor_vulnerability_exceptions` / `harbor_sync_status` | Harbor CVE inventory, exceptions, sync state |
| `pcap_captures` | Packet-capture jobs + protocol/analysis results |
| `ebpf_coverage` | Per-endpoint Beyla/eBPF deployment status |
| `security_destination_rules` | Network egress verdict rules (allow/warn/deny) for observed destinations |
| `image_staleness` | Local-vs-registry image digest comparison results |
| `metrics` | Raw container metrics (also written to TimescaleDB) |
| `kpi_snapshots` | Dashboard KPI aggregates (also in TimescaleDB) |
| `audit_log` | Immutable record of user actions for compliance |
| `stream_tickets` | Single-use, 30s-TTL SSE auth tickets |

### Metrics database (TimescaleDB)

| Object | Purpose |
|--------|---------|
| `metrics` (hypertable) | Raw time-series samples, 7-day chunks, compressed after 7 days (segment by `container_id, metric_type`) |
| `metrics_5min` / `metrics_1hour` / `metrics_1day` | Continuous aggregates (avg/min/max/stddev/count per bucket) — queried by range to keep charts cheap |
| `kpi_snapshots` (hypertable) | Time-series fleet KPI snapshots for dashboard sparklines |

#### Container lifecycle (`container_lifecycle`, TimescaleDB)

The metrics scheduler upserts one row per `(endpoint_id, container_id)` each
collection cycle from the full container list (all states), marking `running`
true/false and reconciling vanished containers to `running = false`. Fleet-level
CPU/memory averages (utilization `fleetSummary`, trends hourly average,
management daily average) filter to `running = TRUE` so stopped/removed
containers no longer dilute them (#1394). The filter is fail-open: if the table
has no rows for the queried scope, all containers are counted. Per-container
charts, forecasts, and the anomaly detector are unaffected. No metric rows are
deleted — time-based retention is unchanged.

## Data Flows

### Container metrics (read path)

```
[Frontend / React Query]
   → GET /api/metrics/:endpointId/:containerId
   → @dashboard/observability route → metrics-store
   → reads metrics_5min | metrics_1hour | metrics_1day (by range)
   → LTTB decimation (≤ 500 points)
   → [UI charts]

[Scheduler every 60s]  → metrics-collector → portainer-client (Redis-cached)
   → compute cpu% / mem% / net rx·tx → metrics-store
   → INSERT app `metrics` + TimescaleDB `metrics` hypertable
```

### Monitoring & anomaly detection

```
[Scheduler]  (polls 60s; runs at MONITORING_INTERVAL_MINUTES)
   → monitoring-service.runMonitoringCycle()
        ├─ adaptive detector (z-score / Bollinger / CV-scaled) + Isolation Forest
        ├─ optional security scan, NLP log analysis, predictive alerting
        ├─ INSERT insights → correlate → incidents
        ├─ critical anomaly → trigger LLM investigation → investigations
        └─ Socket.IO /monitoring → emit insights:new / insights:batch
   → [UI: Health & Monitoring, live]
```

See [AI & Anomaly Detection](../ai-anomaly-detection.md) for detector internals.

### Remediation (observer-first gate)

```
anomaly/incident → remediation-service.suggestAction()
   → protected-container check (destructive action downgraded to INVESTIGATE)
   → INSERT actions (status=pending) → Socket.IO /remediation
   → admin approves  [authenticate + requireRole('admin')]
   → execute via portainer-client → status=executing→completed/failed
   → audit_log entry
```

Both an `admin` role **and** an explicit approval are required before any container-mutating action runs.

### LLM chat

```
[/llm socket: chat:message]  (also REST POST /api/llm/query)
   → prompt-injection guard (regex + heuristic scoring + per-session canary)
   → effective system prompt from prompt_profiles
   → infrastructure context + MCP tools (looped, max tool iterations)
   → stream chunks → chat:chunk … chat:end
   → output sanitization (strip canary, thinking blocks, PII)
   → INSERT llm_traces
```

The guard is applied to both the REST and WebSocket entry points; see CLAUDE.md → Security for the contract.

## Background Scheduler

`packages/server/src/scheduler.ts` starts a set of interval jobs after the cache is warmed and Portainer connectivity is confirmed. Cadences marked *configurable* are read live from Settings/env (changes take effect without restart):

| Job | Cadence | Controlled by |
|-----|---------|---------------|
| Metrics collection | 60s | `METRICS_COLLECTION_INTERVAL_SECONDS` |
| Monitoring cycle | configurable (1-min poll) | `MONITORING_INTERVAL_MINUTES` (Settings) |
| Webhook retry sweep | 30s | `WEBHOOKS_RETRY_INTERVAL_SECONDS` |
| KPI snapshot | 5 min | — |
| Image staleness check | 24h | `IMAGE_STALENESS_CHECK_INTERVAL_HOURS` |
| Harbor CVE sync | configurable (1-min poll) | `HARBOR_SYNC_INTERVAL_MINUTES` (Settings) |
| Portainer backup | configurable | `portainer_backup.interval_hours` (Settings) |
| Daily cleanup (retention) | 24h | — |
| Session cleanup | 60 min | — |
| Dedup telemetry | 60 min | — |
| Stream-ticket cleanup | 5 min | — |
| Anomaly cooldown sweep | 15 min | — |

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
