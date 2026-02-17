# Architecture Overview

Detailed directory structure and responsibilities for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Backend (`backend/src/`) — Fastify 5, TypeScript, PostgreSQL, Socket.IO

| Directory | Purpose |
|-----------|---------|
| `routes/` | REST API endpoints by feature (auth, containers, metrics, monitoring) |
| `services/` | Portainer client, anomaly detection (z-score), monitoring, hybrid cache (Redis + in-memory), Harbor client (vulnerability sync) |
| `sockets/` | Socket.IO: `/llm` (chat), `/monitoring` (insights), `/remediation` (actions) |
| `models/` | Zod schemas + database query functions |
| `db/postgres-migrations/` | PostgreSQL migrations (auto-run via `getAppDb()`) |
| `db/test-db-helper.ts` | Test PostgreSQL helper: `getTestDb()`, `truncateTestTables()`, `closeTestDb()` |
| `scheduler/` | Background: metrics (60s), monitoring (5min), daily cleanup |

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
- **Layered backend architecture**: Routes → Services → Models.
- **Server state**: TanStack React Query. **UI state**: Zustand.
- Zod validation on all Portainer API responses.
- Path alias `@/*` → `./src/*` in both workspaces.
- `PortainerError` with retry + exponential backoff.
- Vite proxies `/api` → `localhost:3051`, `/socket.io` → WebSocket.
- Providers: ThemeProvider > QueryProvider > AuthProvider > SocketProvider > RouterProvider.
