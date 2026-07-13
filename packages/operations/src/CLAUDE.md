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

- `ai-intelligence/index.js` → `chatStream`, `isLlmAvailable`, `getEffectivePrompt`
- `observability/index.js` → `getLatestMetrics`
- `infrastructure/index.js` → `getElasticsearchConfig`

## Key Rules

- Observer-first: `suggestAction` proposes actions; execution requires explicit approval
- Protected containers: `REMEDIATION_PROTECTED_CONTAINERS` env var (defaults protect portainer, redis, etc.)
- Destructive actions on protected containers auto-downgrade to `INVESTIGATE`
