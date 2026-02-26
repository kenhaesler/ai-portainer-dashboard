# Module: observability

Metrics ingestion, anomaly store, capacity forecasting, network rate tracking,
Prometheus export, and distributed tracing.

## Public API (barrel: `index.ts`)

```typescript
import { getMetrics, getLatestMetrics, getLatestMetricsBatch, getMovingAverage } from '../../observability/index.js';
import { detectCorrelatedAnomalies, findCorrelatedContainers, findSimilarInsights } from '../../observability/index.js';
import { generateForecast, getCapacityForecasts } from '../../observability/index.js';
```

Routes are registered in `app.ts` via `observabilityRoutes` from the barrel.

## Cross-domain Imports (Phase 3 Exceptions)

Routes use LLM services for AI-generated summaries/narratives:
- `ai-intelligence/index.js` → `chatStream`, `getEffectivePrompt`, `getPromptGuardNearMissTotal`

## Key Rules

- Always check `isUndefinedTableError` when querying TimescaleDB tables
- Prometheus endpoint requires `PROMETHEUS_BEARER_TOKEN` (>= 16 chars) in production
- LTTB decimation applied to raw metric queries (500 points for frontend)
