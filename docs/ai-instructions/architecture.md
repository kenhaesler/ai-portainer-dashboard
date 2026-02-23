# Architecture Overview

Detailed directory structure and responsibilities for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Backend (`backend/src/`) — Fastify 5, TypeScript, PostgreSQL, Socket.IO

| Directory | Purpose |
|-----------|---------|
| `core/config/` | Env schema (Zod), validated config singleton |
| `core/db/` | PostgreSQL pools, adapter, migrations (postgres + timescale), test helpers |
| `core/utils/` | Logger (pino), crypto (JWT/bcrypt), log sanitizer, network security |
| `core/models/` | Zod schemas + TypeScript interfaces (auth, portainer, metrics, tracing, etc.) |
| `core/plugins/` | Fastify plugins (auth, CORS, rate-limit, tracing, compression, Socket.IO, etc.) |
| `core/portainer/` | Portainer API client, Redis cache, normalizers, circuit breaker |
| `core/tracing/` | Distributed tracing context, span storage, OTLP export/transform |
| `core/services/` | Auth stores (session, user), settings, audit logger, event bus, OIDC |
| `modules/security/` | Security domain module: scanner, audit, Harbor, PCAP, eBPF, image staleness |
| `routes/` | REST API endpoints by feature (auth, containers, metrics, monitoring) |
| `services/` | Domain services: LLM, anomaly detection, monitoring, incidents, etc. |
| `sockets/` | Socket.IO: `/llm` (chat), `/monitoring` (insights), `/remediation` (actions) |
| `scheduler/` | Background: metrics (60s), monitoring (5min), daily cleanup |
| `utils/` | Domain-specific utils (pii-scrubber) — not kernel |

## Frontend (`frontend/src/`) — React 19, TypeScript, Vite, Tailwind CSS v4

| Directory | Purpose |
|-----------|---------|
| `pages/` | 18 lazy-loaded pages (Suspense-wrapped) |
| `components/` | By domain: `layout/`, `charts/`, `shared/`, `container/`, `network/` |
| `hooks/` | TanStack React Query wrappers |
| `stores/` | Zustand stores (theme, sidebar, notifications, filters) |
| `providers/` | Auth, theme, Socket.IO, React Query providers |
| `lib/api.ts` | Singleton API client with 401 auto-refresh |

## Key Patterns

- **Observer-First principle**: Visibility prioritized; actions require explicit approval.
- **Modular backend architecture**: `modules/<domain>/` for domain-specific code, barrel `index.ts` as public API. Routes → Services/Modules → Core.
- Domain modules: `modules/security/` (services, routes, models, tests). More modules planned (ai-intelligence, monitoring).
- **Server state**: TanStack React Query. **UI state**: Zustand.
- Zod validation on all Portainer API responses.
- Path alias `@/*` → `./src/*` in both workspaces.
- `PortainerError` with retry + exponential backoff.
- Vite proxies `/api` → `localhost:3051`, `/socket.io` → WebSocket.
- Providers: ThemeProvider > QueryProvider > AuthProvider > SocketProvider > RouterProvider.
