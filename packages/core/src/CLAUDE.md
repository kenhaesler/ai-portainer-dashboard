# Core Kernel (packages/core/)

Shared foundation — all domain modules depend on core.
**core/ MUST NOT import from**: domain packages, `routes/`, `sockets/`, `scheduler/`

## Sub-modules

- **config/**: Env schema (Zod), validated config singleton
- **db/**: PostgreSQL pools, adapter, migrations, test helpers
- **utils/**: Logger (pino), crypto (JWT/bcrypt), log sanitizer, PII scrubber, network security, safe paths
- **models/**: Zod schemas + TypeScript interfaces (auth, portainer, metrics, tracing, settings, etc.)
- **plugins/**: Fastify plugins (auth, CORS, rate-limit, tracing, compression, Socket.IO, Swagger, security headers, cache control, static)
- **portainer/**: API client, Redis cache, normalizers (standard + edge), circuit breaker
- **tracing/**: Distributed tracing context, span storage, OTLP export/transform
- **services/**: Auth stores (session, user), settings, audit logger, typed event bus, OIDC

## Security-Critical Files

- `utils/crypto.ts` — JWT signing (HS256/RS256/ES256), password hashing (bcrypt)
- `plugins/auth.ts` — RBAC decorator (`fastify.authenticate`, `fastify.requireRole`)
- `services/session-store.ts` — Server-side session validation
- `services/user-store.ts` — User CRUD, role management, OIDC user upsert
- `services/oidc.ts` — OIDC/SSO with PKCE (openid-client v6)

## Dependency Direction

```
@dashboard/server  (composition root — wires everything)
       ↓
@dashboard/ai, @dashboard/observability, @dashboard/operations,
@dashboard/security, @dashboard/infrastructure
       ↓
@dashboard/core  (kernel)
       ↓
@dashboard/contracts  (interfaces + schemas)
       ↓
(npm packages only)
```

- `@dashboard/ai` imports ONLY core + contracts (never other domains)
- Cross-domain deps resolved via DI in `@dashboard/server/src/wiring.ts`
- Routes NOT re-exported from barrel (import directly from `routes/index.js`)

## Domain Packages (`packages/<domain>/`)

Each package has: `services/`, `routes/`, optionally `models/`, `sockets/`, `__tests__/`, and a barrel `index.ts`.
- External consumers import ONLY from the barrel (`@dashboard/<domain>`)
- Routes are NOT re-exported from barrel (import directly from `routes/index.js` to avoid TDZ issues)
- Internal module imports use relative paths between siblings
- Cross-domain imports allowed via Phase 3 exceptions (documented in each module's CLAUDE.md)
