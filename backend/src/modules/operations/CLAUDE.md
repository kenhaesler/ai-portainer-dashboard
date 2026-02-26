# Module: operations

Remediation workflow (suggest → approve → execute), notifications, backup, and webhooks.

## Public API (barrel: `index.ts`)

```typescript
import { suggestAction, approveAction, rejectAction } from '../../operations/index.js';
import { notifyInsight } from '../../operations/index.js';
import { remediationRoutes, backupRoutes, logsRoutes } from '../../operations/index.js';
```

## Cross-domain Imports (Phase 3 Exceptions)

- `ai-intelligence/index.js` → `chatStream`, `isOllamaAvailable`, `getEffectivePrompt`
- `observability/index.js` → `getLatestMetrics`
- `infrastructure/index.js` → `getElasticsearchConfig`

## Key Rules

- Observer-first: `suggestAction` proposes actions; execution requires explicit approval
- Protected containers: `REMEDIATION_PROTECTED_CONTAINERS` env var (defaults protect portainer, redis, etc.)
- Destructive actions on protected containers auto-downgrade to `INVESTIGATE`
