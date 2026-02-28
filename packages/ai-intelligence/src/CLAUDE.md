# Module: ai-intelligence

LLM-powered chat, anomaly detection (statistical + isolation forest), incident correlation,
monitoring orchestration, prompt management, and MCP tool bridge.

**Critical isolation rule:** This package imports ONLY `@dashboard/core` and `@dashboard/contracts`.
It MUST NOT import from other domain packages (observability, operations, security, infrastructure).
Cross-domain data flows through DI adapters wired in `@dashboard/server/src/wiring.ts`.

## Public API (barrel: `index.ts`)

```typescript
// Routes
import { monitoringRoutes, investigationRoutes, incidentsRoutes, correlationRoutes } from '@dashboard/ai';
import { llmRoutes, llmObservabilityRoutes, llmFeedbackRoutes, mcpRoutes, promptProfileRoutes } from '@dashboard/ai';

// Sockets
import { setupLlmNamespace, setupMonitoringNamespace, broadcastInsight, broadcastInsightBatch } from '@dashboard/ai';

// Monitoring orchestration
import { createMonitoringService, startCooldownSweep, stopCooldownSweep } from '@dashboard/ai';

// LLM client
import { isOllamaAvailable, chatStream, buildInfrastructureContext } from '@dashboard/ai';

// Prompt management
import { PROMPT_FEATURES, DEFAULT_PROMPTS, getEffectivePrompt } from '@dashboard/ai';

// Anomaly detection
import { detectAnomaly, detectAnomalyAdaptive, detectAnomaliesBatch, correlateInsights } from '@dashboard/ai';

// Investigation
import { triggerInvestigation, initInvestigationDeps } from '@dashboard/ai';

// Prompt guard
import { getPromptGuardNearMissTotal } from '@dashboard/ai';

// MCP
import { autoConnectAll, disconnectAll } from '@dashboard/ai';
```

## Cross-domain Imports

**None.** This package depends only on `@dashboard/core` and `@dashboard/contracts`.

Cross-domain dependencies (metrics, security scanning, notifications) are injected at startup via:
- `initInvestigationDeps()` — receives metrics functions from observability
- `createMonitoringService(deps)` — receives scanner, metrics, notifications, operations adapters
- `correlationRoutes` options — receives observability functions

All wiring happens in `@dashboard/server/src/wiring.ts`.

## Security-Critical Files

- `services/prompt-guard.ts` — 3-layer prompt injection defense (regex 25+, heuristic scoring, output sanitization)
- `services/llm-client.ts` — LLM communication (gated by `isOllamaAvailable()`)

## Key Rules

- **Never add imports from other domain packages** — use DI via `initInvestigationDeps()` or `createMonitoringService(deps)`
- All LLM queries must pass through prompt guard before reaching the model
- Cooldown sweep prevents alert spam (configurable per anomaly type)
- MCP tools auto-connect at server startup; manually configurable via routes
