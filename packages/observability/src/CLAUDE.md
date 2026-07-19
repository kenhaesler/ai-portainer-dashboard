# Module: observability

Metrics ingestion, anomaly store, capacity forecasting, network rate tracking,
Prometheus export, and distributed tracing.

## Public API (barrel: `index.ts`)

```typescript
import { getMetrics, getLatestMetrics, getLatestMetricsBatch, getMovingAverage } from '../../observability/index.js';
import { detectCorrelatedAnomalies, findCorrelatedContainers, findSimilarInsights } from '../../observability/index.js';
import { generateForecast, getCapacityForecasts } from '../../observability/index.js';
```

Routes are registered in `app.ts` via `observabilityRoutes` imported from
`@dashboard/observability/routes/index.js` — **not** the package barrel, which no
longer re-exports routes (core/src/CLAUDE.md rule, #1533).

## Cross-domain Imports (Phase 3 Exceptions)

**None.** This package imports only `@dashboard/core` and `@dashboard/contracts` — see the
allowed-import table in `packages/core/src/CLAUDE.md`.

Routes that produce AI-generated summaries/narratives do **not** import `@dashboard/ai`. They
receive an `LLMInterface` (`@dashboard/contracts`) as a route option, injected from
`@dashboard/server/src/wiring.ts`, and call `opts.llm.chatStream(...)` /
`opts.llm.getEffectivePrompt(...)` through it (`routes/metrics.ts`, `routes/forecasts.ts`;
`getPromptGuardNearMissTotal` is likewise passed in via `routes/index.ts` options). Importing
`@dashboard/ai` here would fail lint (#1585).

## Key Rules

- Always check `isUndefinedTableError` when querying TimescaleDB tables
- Prometheus endpoint requires `PROMETHEUS_BEARER_TOKEN` (>= 16 chars) in production
- LTTB decimation applied to raw metric queries (500 points for frontend)
