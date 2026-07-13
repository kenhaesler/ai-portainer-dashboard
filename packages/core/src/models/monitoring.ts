/**
 * Anomaly / insight domain model.
 *
 * The canonical definitions live in `@dashboard/contracts` so there is exactly
 * ONE physical `InsightSchema` / `AnomalyDimensionSchema` / detector-constant
 * set shared by the backend (which imports from `@dashboard/core/models/monitoring.js`)
 * and the frontend (which imports from `@dashboard/contracts`) — see #1509.
 * This module is a thin re-export kept for the many backend call sites that
 * already import from here; do not redeclare the shapes below.
 */
export {
  AnomalyDimensionSchema,
  PERSISTED_ANOMALY_DETECTORS,
  IN_MEMORY_ANOMALY_DETECTORS,
  ANOMALY_DETECTORS,
  InsightSchema,
} from '@dashboard/contracts';

export type {
  AnomalyDimension,
  PersistedAnomalyDetector,
  AnomalyDetector,
  Insight,
} from '@dashboard/contracts';
