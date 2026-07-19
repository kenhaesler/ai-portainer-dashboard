# Module: security

Container security scanning, PCAP network capture analysis, Harbor vulnerability
management, image staleness checking, and security audit.

## Public API (barrel: `index.ts`)

```typescript
import { scanContainer, scanCapabilityPosture } from '../../security/index.js';
import { getSecurityAudit, buildSecurityAuditSummary } from '../../security/index.js';
import { runHarborSync, isHarborConfigured, cleanupOldVulnerabilities } from '../../security/index.js';
import { cleanupOldCaptures, cleanupOrphanedSidecars } from '../../security/index.js';
```

**Note:** Routes are imported directly from `routes/index.ts` in `app.ts` (not from barrel).

## Cross-domain Imports (Phase 3 Exceptions)

- `@dashboard/infrastructure` → `assertCapability` (edge capability checking, `routes/pcap.ts`)

`@dashboard/infrastructure` is a sanctioned sub-tier, not a domain peer — see the allowed-import
table in `packages/core/src/CLAUDE.md`. This is the only cross-domain import edge in this package.

**LLM access is NOT an import.** `pcap-analysis-service.ts` receives an `LLMInterface`
(`@dashboard/contracts`) injected from `@dashboard/server/src/wiring.ts` and calls
`llm.chatStream(...)` / `llm.getEffectivePrompt(...)` through it. `@dashboard/ai` is not a
dependency of this package and importing it would fail lint (#1585).

## Key Rules

- All PCAP endpoints check `config.PCAP_ENABLED` before proceeding
- Observer-first: security scanning is read-only, never modifies container state
