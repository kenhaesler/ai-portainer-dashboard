// Public API for the observability module.
// Import from this file in cross-domain consumers (scheduler, AI services, other routes).

// Routes
export { observabilityRoutes } from './routes/index.js';

// Services — metrics collection and storage
export type { CollectedMetrics } from './services/metrics-collector.js';
export { collectMetrics } from './services/metrics-collector.js';

export type { MetricInsert, NetworkRate, MovingAverageResult } from './services/metrics-store.js';
export {
  isUndefinedTableError,
  insertMetrics,
  getMetrics,
  getMovingAverage,
  cleanOldMetrics,
  getLatestMetrics,
  getLatestMetricsBatch,
  getNetworkRates,
  getAllNetworkRates,
} from './services/metrics-store.js';

export type { RollupSelection } from './services/metrics-rollup-selector.js';
export { selectRollupTable } from './services/metrics-rollup-selector.js';

export type { DataPoint } from './services/lttb-decimator.js';
export { decimateLTTB } from './services/lttb-decimator.js';

// Services — KPI
export type { KpiSnapshot } from './services/kpi-store.js';
export {
  insertKpiSnapshot,
  getKpiHistory,
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
  _resetTracker,
} from './services/network-rate-tracker.js';

// Services — status page
export type { StatusPageConfig, ServiceStatus, UptimeDayBucket } from './services/status-page-store.js';
export {
  getStatusPageConfig,
  getOverallUptime,
  getEndpointUptime,
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
export type { Queryable, CorrelatedAnomaly, CorrelationPair } from './services/metric-correlator.js';
export {
  pearsonCorrelation,
  calculateCompositeScore,
  identifyPattern,
  scoreSeverity,
  correlationStrength,
  findCorrelatedContainers,
  detectCorrelatedAnomalies,
} from './services/metric-correlator.js';

// Route helpers (exported for testing)
export {
  clearNarrativeCache,
  buildForecastPrompt,
} from './routes/forecasts.js';

export {
  resetPrometheusMetricsCacheForTests,
} from './routes/prometheus.js';

export {
  clearReportCache,
} from './routes/reports.js';
