# Core Kernel (backend/src/core/)

Shared foundation — all domain modules depend on core.
**core/ MUST NOT import from**: `routes/`, `services/` (non-core), `sockets/`, `scheduler/`

## Sub-modules

- **config/**: Env schema (Zod), validated config singleton
- **db/**: PostgreSQL pools, adapter, migrations, test helpers
- **utils/**: Logger (pino), crypto (JWT/bcrypt), log sanitizer, network security
- **models/**: Zod schemas + TypeScript interfaces (auth, portainer, metrics, tracing, etc.)
- **plugins/**: Fastify plugins (auth, CORS, rate-limit, tracing, compression, Socket.IO, etc.)
- **portainer/**: API client, Redis cache, normalizers, circuit breaker
- **tracing/**: Distributed tracing context, span storage, OTLP export/transform
- **services/**: Auth stores (session, user), settings, audit logger, event bus, OIDC

## Security-Critical Files

- `utils/crypto.ts` — JWT signing (HS256/RS256/ES256), password hashing (bcrypt)
- `plugins/auth.ts` — RBAC decorator (`fastify.authenticate`, `fastify.requireRole`)
- `services/session-store.ts` — Server-side session validation
- `services/user-store.ts` — User CRUD, role management, OIDC user upsert
- `services/oidc.ts` — OIDC/SSO with PKCE (openid-client v6)

## Dependency Direction

```
routes/ ────────→ modules/*/ ──→ core/
services/ ──────→ core/
modules/infrastructure/ → core/ (no cross-module deps)
modules/observability/ → core/ (+ cross-domain: services/llm-client, services/prompt-store, services/prompt-guard)
modules/security/ → core/ + modules/infrastructure/ (+ cross-domain: services/llm-client, services/prompt-store)
sockets/ ───────→ core/
scheduler/ ─────→ modules/*/ ──→ core/
core/ ──────────→ (npm packages only, never imports from above)
```

## Domain Modules (`modules/<domain>/`)

Each module has: `services/`, `routes/`, `models/`, `__tests__/`, and a barrel `index.ts`.
- External consumers import ONLY from the barrel (`modules/security/index.ts`, `modules/infrastructure/index.ts`, `modules/observability/index.ts`)
- Routes are NOT re-exported from barrel (import directly from `routes/index.js`)
- Internal module imports use relative paths between siblings
- Cross-module imports allowed in Phase 2 (e.g., security → infrastructure)
