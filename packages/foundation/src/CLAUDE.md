# Module: foundation

Foundational, cross-domain HTTP routes — the "glue" layer between the Portainer
API, core services, and the frontend. These routes (auth, OIDC, users, settings,
dashboard, containers, container-logs, endpoints, stacks, images, networks,
kubernetes, search, cache-admin, system-info, health) don't belong to any single
domain module, so they were extracted here (issue #914 / PR #944) rather than
into a domain package.

foundation contains **only** route handlers (`routes/`, `index.ts`, `__tests__/`).
The reusable auth/session/OIDC/user logic it calls lives in `@dashboard/core`
services — foundation itself holds no services, which is why no domain package
ever needs (or is allowed) to import from it.

## Public API

Routes are registered from the composition root via
`@dashboard/foundation/routes/index.js` — **not** the package barrel
(`@dashboard/foundation`), matching every other package and the
`core/src/CLAUDE.md` "routes not re-exported from the barrel" rule (#1533). The
package barrel (`index.ts`) is intentionally empty.

## Cross-domain Imports (sanctioned aggregation/BFF layer)

Unlike the domain packages (which resolve cross-domain deps via DI in
`@dashboard/server/src/wiring.ts`), foundation's aggregation routes import domain
**services** directly. This is a documented exception, not a violation:

- `@dashboard/observability` → `getKpiHistory`, `getLatestMetricsBatch`, `getLatestKpiSnapshot` (dashboard.ts)
- `@dashboard/security` → `buildSecurityAuditSummary`, `getSecurityAudit`, image-staleness helpers (dashboard.ts, images.ts)
- `@dashboard/ai` → `PROMPT_FEATURES`, `getEffectivePrompt`, prompt-version helpers (settings.ts)
- `@dashboard/infrastructure` → log/search helpers (container-logs.ts, search.ts)

foundation never imports `@dashboard/operations` (it depends on 4 of 5 domains).

## Key Rules

- **No services here** — put reusable logic in `@dashboard/core`; foundation is routes only.
- **Never import from foundation in a domain package** — it depends on most domains, so any
  such import would create a cycle.
- Route files that use `fastify.authenticate`/`requireRole`, `request.user`/`requestId`,
  or swagger `schema.tags` must side-effect-import the declaring modules
  (`@dashboard/core/plugins/auth.js`, `@dashboard/core/plugins/request-tracing.js`,
  `@fastify/swagger`) — these no longer arrive implicitly through domain barrels (#1533).
