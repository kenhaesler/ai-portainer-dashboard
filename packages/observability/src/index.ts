// Public API for the observability module.
// Import from this file in cross-domain consumers (scheduler, AI services, other routes).
//
// Routes are NOT re-exported here (core/src/CLAUDE.md rule) — register them via
// `@dashboard/observability/routes/index.js` in the composition root. Keeping
// routes out of the barrel also stops barrel consumers from transitively
// evaluating route modules (and their lazy cache-sweep timers) at import (#1533).

// Services — metrics collection and storage
export type { CollectedMetrics } from './services/metrics-collector.js';
export { collectMetrics } from './services/metrics-collector.js';

export type { MetricInsert, NetworkRate, MovingAverageResult } from './services/metrics-store.js';
export {
  isUndefinedTableError,
  insertMetrics,
  getMetrics,
  getMovingAverage,
  getMovingAverageByHourOfDay,
  getMetricWindow,
  getMetricWindowByHourOfDay,
  cleanOldMetrics,
  getLatestMetrics,
  getLatestMetricsBatch,
  getNetworkRates,
  getAllNetworkRates,
} from './services/metrics-store.js';

export type { LifecycleContainer } from './services/container-lifecycle-store.js';
export {
  upsertContainerLifecycle,
  getRunningContainerIds,
} from './services/container-lifecycle-store.js';

export type { RollupSelection } from './services/metrics-rollup-selector.js';
export { selectRollupTable } from './services/metrics-rollup-selector.js';

export type { DataPoint } from './services/lttb-decimator.js';
export { decimateLTTB } from './services/lttb-decimator.js';

// Services — trace retention
export { cleanOldSpans } from './services/trace-retention.js';

// Services — trace RED metrics
export { computeRed } from './services/trace-red.js';
export type {
  RedQuery,
  RedResult,
  RedRow,
  RedBucket,
  RedGroupBy,
} from './services/trace-red.js';

// Services — KPI
export type { KpiSnapshot } from './services/kpi-store.js';
export {
  insertKpiSnapshot,
  getKpiHistory,
  getLatestKpiSnapshot,
  cleanOldKpiSnapshots,
} from './services/kpi-store.js';

// Services — capacity forecasting
export type { ForecastPoint, CapacityForecast } from './services/capacity-forecaster.js';
export {
  linearRegression,
  lookupContainerName,
  generateForecast,
  getCapacityForecasts,
  resetForecastCache,
} from './services/capacity-forecaster.js';

// Services — network rate tracking
export type { LiveNetworkRate } from './services/network-rate-tracker.js';
export {
  recordNetworkSample,
  getRatesForEndpoint,
  getAllRates,
  pruneStaleEntries,
  _resetTracker,
} from './services/network-rate-tracker.js';

// Services — status page
export type { StatusPageConfig, ServiceStatus, UptimeDayBucket, UptimeSummary, UptimeWindows } from './services/status-page-store.js';
export {
  getStatusPageConfig,
  getOverallUptime,
  getEndpointUptime,
  getUptimeSummary,
  getLatestSnapshot,
  getDailyUptimeBuckets,
  getRecentIncidentsPublic,
} from './services/status-page-store.js';

// Services — alert similarity
export type { SimilarInsightGroup } from './services/alert-similarity.js';
export {
  tokenize,
  jaccardSimilarity,
  findSimilarInsights,
} from './services/alert-similarity.js';

// Services — infrastructure classification
export {
  getInfrastructureServicePatterns,
  matchesInfrastructurePattern,
  isInfrastructureService,
} from './services/infrastructure-service-classifier.js';

// Services — metric correlation
export type {
  Queryable,
  CorrelatedAnomaly,
  CorrelationPair,
  MetricPatternId,
  MetricPatternMatch,
  PatternMetricObservation,
} from './services/metric-correlator.js';
export {
  pearsonCorrelation,
  calculateCompositeScore,
  identifyPattern,
  PATTERN_Z_SCORE_THRESHOLD,
  scoreSeverity,
  correlationStrength,
  findCorrelatedContainers,
  detectCorrelatedAnomalies,
} from './services/metric-correlator.js';

// Route-internal test helpers are intentionally NOT re-exported from the barrel
// (they live in ./routes/*.js and pull in route modules + their timers). Tests
// import them directly from the route files (see src/__tests__).
