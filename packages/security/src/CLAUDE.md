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

- `infrastructure/index.js` → `assertCapability` (edge capability checking)
- `ai-intelligence/index.js` → `isOllamaAvailable`, `chatStream`, `getEffectivePrompt`

## Key Rules

- All PCAP endpoints check `config.PCAP_ENABLED` before proceeding
- Observer-first: security scanning is read-only, never modifies container state
