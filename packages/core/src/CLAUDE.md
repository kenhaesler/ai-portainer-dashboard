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

**This table is the authoritative, machine-enforced allowed-import list (#1585).**
Every package may always import itself; `@dashboard/ai` lives in `packages/ai-intelligence/`.

| Package | May import |
|---------|------------|
| `contracts` | (nothing — leaf; npm only) |
| `core` | contracts |
| `infrastructure` | core, contracts |
| `observability` | core, contracts |
| `ai` | core, contracts |
| `security` | infrastructure, core, contracts |
| `operations` | infrastructure, core, contracts |
| `foundation` | ai, observability, security, infrastructure, core, contracts — **never operations** |
| `server` | everything (composition root) |

Tiers, highest first. Each tier may import only from tiers below it, narrowed by the table above
(the table is authoritative where the two appear to differ).

```
composition root   @dashboard/server          may import anything
BFF / aggregation  @dashboard/foundation      4 of 5 domains, never operations
domains            @dashboard/ai              core + contracts only (hard isolation)
                   @dashboard/observability   core + contracts only
                   @dashboard/security        + infrastructure
                   @dashboard/operations      + infrastructure
sub-tier           @dashboard/infrastructure  core + contracts
kernel             @dashboard/core            contracts
leaf               @dashboard/contracts       npm only (zod)
```

- `@dashboard/infrastructure` is a sanctioned **sub-tier**, not a domain peer: `security` and
  `operations` may import it directly (`assertCapability`, `getElasticsearchConfig` — see each
  package's own CLAUDE.md). `ai` and `observability` may not.
- `@dashboard/ai` imports ONLY core + contracts (hard isolation — never another domain).
  Its directory is `packages/ai-intelligence/`.
- All other cross-domain access is resolved via DI in `@dashboard/server/src/wiring.ts`, against
  interfaces declared in `@dashboard/contracts` (`LLMInterface`, `MetricsInterface`, …). A package
  consuming another domain's behaviour through an injected interface does **not** create an import
  edge and is not a boundary exception.
- `@dashboard/foundation` is a sanctioned exception: its route handlers may import
  domain-package **services** directly (ai, observability, security, infrastructure —
  never operations) as an aggregation/BFF layer. See `packages/foundation/src/CLAUDE.md`.
  Because it depends on 4 of 5 domains, no domain package may import from foundation.
- Routes NOT re-exported from any package barrel — register them from
  `@dashboard/<pkg>/routes/index.js` (foundation included). This avoids TDZ issues and
  keeps route-module side effects (e.g. cache-sweep timers) off the barrel import path.

### Enforcement (#1585)

These directions are **machine-enforced** by `eslint-plugin-boundaries` in
`eslint.packages.config.mjs` at the repo root, run by `npm run lint` via the `lint:packages`
script (CI runs a bare `npm run lint`). A forbidden import fails lint — the table above is not
advisory.

- **Adding a package requires two edits** in `eslint.packages.config.mjs`: an entry in
  `boundaries/elements` *and* a policy entry granting its allowed imports. Without both, its
  imports are **denied by default** (`boundaries/no-unknown-dependencies` is `error`, so an
  undeclared package cannot slip past every policy instead of failing).
- `tsconfig.eslint.json` exists **solely** to pin lint-time resolution of `@dashboard/*` to
  `packages/<dir>/src`. Each package's `exports` map points at `./dist`, and `dist/` is
  gitignored — a dist-resolved config would silently resolve nothing on a fresh clone or a
  pre-build CI run, and unresolved specifiers are classified `external` and never policy-checked.
  That is a gate that passes vacuously; do not "simplify" it away.
- Do not add a blanket `boundaries/ignore` for tests. Tests do not widen the import graph, and an
  over-broad ignore is precisely what made the old `backend/eslint.config.js` rules a no-op.

## Domain Packages (`packages/<domain>/`)

Each package has: `services/`, `routes/`, optionally `models/`, `sockets/`, `__tests__/`, and a barrel `index.ts`.
- External consumers import ONLY from the barrel (`@dashboard/<domain>`)
- Routes are NOT re-exported from barrel (import directly from `routes/index.js` to avoid TDZ
  issues) — enforced by lint, not convention (#1585)
- Internal module imports use relative paths between siblings
- The only cross-domain import edges outside `foundation`/`server` are the two sanctioned
  `@dashboard/infrastructure` edges (`security` → `assertCapability`, `operations` →
  `getElasticsearchConfig`), documented as Phase 3 exceptions in those packages' CLAUDE.md.
  Everything else crosses via DI and is not an import.
