# Module: ai-intelligence

Owner domain for LLM, anomaly detection, monitoring orchestration, and AI insights.

## Public API (barrel: `index.ts`)

```typescript
import { chatStream, isOllamaAvailable, ensureModel } from '../../ai-intelligence/index.js';
import { getEffectivePrompt, PROMPT_FEATURES, DEFAULT_PROMPTS } from '../../ai-intelligence/index.js';
import { runMonitoringCycle, setMonitoringNamespace } from '../../ai-intelligence/index.js';
import { monitoringRoutes, investigationRoutes, incidentsRoutes, llmRoutes } from '../../ai-intelligence/index.js';
import { getPromptGuardNearMissTotal } from '../../ai-intelligence/index.js';
```

## Internal Structure

| File | Purpose |
|------|---------|
| `services/llm-client.ts` | Ollama API client, streaming chat, PII scrubbing |
| `services/monitoring-service.ts` | Orchestrates monitoring cycle (metrics → anomaly → insight → action) |
| `services/investigation-service.ts` | Deep-dive container investigation via LLM |
| `services/anomaly-detector.ts` | Z-score + Bollinger band anomaly detection |
| `services/adaptive-anomaly-detector.ts` | Adaptive threshold anomaly detection |
| `services/isolation-forest-detector.ts` | Isolation Forest ML-based anomaly detection |
| `services/incident-correlator.ts` | Groups related insights into incidents |
| `services/prompt-guard.ts` | Prompt injection detection (3-layer) |
| `services/prompt-store.ts` | System prompt management and versioning |

## Cross-domain Imports (Phase 3 Exceptions)

Annotated with `// eslint-disable-next-line boundaries/element-types -- Phase 3: ...`:
- `security/index.js` → `scanContainer`, `getSecurityAudit`
- `observability/index.js` → `getLatestMetricsBatch`, `getCapacityForecasts`, `findSimilarInsights`
- `operations/index.js` → `suggestAction`, `notifyInsight`

## Key Rules

- Never bypass the prompt guard for user-facing LLM calls
- PII scrubbing is mandatory in `llm-client.ts`
- Observer-first: this module suggests actions, never executes container mutations
