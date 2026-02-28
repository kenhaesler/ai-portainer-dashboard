# Package: server (Composition Root)

Application bootstrap, DI wiring, route registration, scheduler, and Socket.IO setup.
This is the **only package** that imports from all domain packages.

## Key Files

| File | Purpose |
|------|---------|
| `app.ts` | Fastify factory — registers plugins, builds DI adapters, registers all routes |
| `wiring.ts` | DI wiring — the **single place** that imports from all domain packages |
| `scheduler.ts` | Background jobs: metrics collection (60s), monitoring cycle (5min), daily cleanup |
| `socket-setup.ts` | Socket.IO namespace initialization (`/llm`, `/monitoring`, `/remediation`) |
| `index.ts` | Entry point — DB init, server start, graceful shutdown (SIGTERM/SIGINT) |

## DI Pattern (`wiring.ts`)

Cross-domain communication is resolved by building adapters that implement contract interfaces:

```typescript
buildLlmAdapter()        → LLMInterface         (wraps @dashboard/ai services)
buildMetricsAdapter()    → MetricsInterface      (wraps @dashboard/observability services)
infraLogsAdapter         → InfrastructureLogsInterface (wraps @dashboard/infrastructure services)
buildMonitoringService() → wires scanner, metrics, notifications, operations
```

Adapters are passed to domain routes/services via `Fastify.register()` options or `init*Deps()` functions.

## Key Rules

- **All cross-domain imports belong in `wiring.ts`** — never add domain package imports to `app.ts` or other files (except route imports for registration)
- Route registration order: backend foundational routes first, then domain package routes
- `initRemediationDeps()` and `initInvestigationDeps()` must be called before route registration
- Scheduler starts after server is listening (called from `index.ts`)
