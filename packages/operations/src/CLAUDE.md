# Module: operations

Remediation workflow (suggest → approve → execute), notifications, backup, and webhooks.

## Public API (barrel: `index.ts`)

```typescript
import { suggestAction, approveAction, rejectAction } from '@dashboard/operations';
import { notifyInsight } from '@dashboard/operations';
// Routes are registered from the routes subpath, NOT the package barrel
// (core/src/CLAUDE.md rule; the barrel no longer re-exports them, #1533)
import { remediationRoutes, backupRoutes, logsRoutes } from '@dashboard/operations/routes/index.js';
```

## Cross-domain Imports (Phase 3 Exceptions)

- `@dashboard/infrastructure` → `getElasticsearchConfig` (`routes/logs.ts`)

`@dashboard/infrastructure` is a sanctioned sub-tier, not a domain peer — see the allowed-import
table in `packages/core/src/CLAUDE.md`. This is the only cross-domain import edge in this package.

**LLM and metrics access are NOT imports.** `remediation-service.ts` holds an `LLMInterface` and a
`MetricsInterface` (both `@dashboard/contracts`) supplied by `initRemediationDeps(llm, metrics)`
from `@dashboard/server/src/wiring.ts`, and reaches `chatStream` / `isAvailable` /
`getEffectivePrompt` / `getLatestMetrics` through those. Neither `@dashboard/ai` nor
`@dashboard/observability` is a dependency of this package; importing either would fail lint
(#1585). Note that `foundation` deliberately never imports `operations`.

## Key Rules

- Observer-first: `suggestAction` proposes actions; execution requires explicit approval
- Protected containers: `REMEDIATION_PROTECTED_CONTAINERS` env var (defaults protect portainer, redis, etc.)
- Destructive actions on protected containers auto-downgrade to `INVESTIGATE`
