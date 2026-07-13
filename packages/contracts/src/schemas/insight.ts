import { z } from 'zod/v4';

export const SeveritySchema = z.enum(['critical', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Per-signal payload carried by `Insight.dimensions` when an anomaly fires
 * for the same `(service, minute)` window across more than one dimension
 * (e.g. trace-anomaly's correlated p95-latency + error-rate suppression —
 * see #1296). Single-dimension records leave `dimensions` undefined.
 *
 * `type` mirrors `metric_type` so consumers can derive severity per signal.
 */
export const AnomalyDimensionSchema = z.object({
  type: z.enum(['cpu', 'memory', 'disk', 'network', 'restart', 'latency_p95', 'error_rate']),
  value: z.number(),
  baseline: z.number(),
  zScore: z.number(),
  severity: z.enum(['critical', 'warning']),
});
export type AnomalyDimension = z.infer<typeof AnomalyDimensionSchema>;

/**
 * Canonical anomaly-detector identifiers — single source of truth (#1314).
 *
 * `PERSISTED_ANOMALY_DETECTORS` are the only values that can land in
 * `insights.detection_method`. `IN_MEMORY_ANOMALY_DETECTORS` are correlated /
 * in-memory detectors that never reach the `insights` table but DO appear on
 * `anomaly_feedback.detector`. The anomaly-feedback route allowlist accepts the
 * union (`ANOMALY_DETECTORS`); the persisted-record schema accepts only the
 * persisted subset. Adding a detector source is now a single edit here.
 *
 * These live in contracts (not core) so `packages/core/src/models/monitoring.ts`
 * can re-export them and there is exactly one physical `InsightSchema`/detector
 * definition shared by the backend and the frontend (#1509).
 */
export const PERSISTED_ANOMALY_DETECTORS = [
  'threshold',
  'ml-anomaly',
  'prediction',
  'health-check',
  'log-pattern',
  'security-scan',
] as const;

export const IN_MEMORY_ANOMALY_DETECTORS = [
  'correlated-zscore',
  'isolation-forest',
] as const;

export const ANOMALY_DETECTORS = [
  ...PERSISTED_ANOMALY_DETECTORS,
  ...IN_MEMORY_ANOMALY_DETECTORS,
] as const;

export type PersistedAnomalyDetector = (typeof PERSISTED_ANOMALY_DETECTORS)[number];
export type AnomalyDetector = (typeof ANOMALY_DETECTORS)[number];

export const InsightSchema = z.object({
  id: z.string(),
  endpoint_id: z.number().nullable(),
  endpoint_name: z.string().nullable(),
  container_id: z.string().nullable(),
  container_name: z.string().nullable(),
  severity: SeveritySchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
  suggested_action: z.string().nullable(),
  is_acknowledged: z.number().default(0),
  created_at: z.string(),
  metric_type: z.enum(['cpu', 'memory', 'disk', 'network', 'restart', 'latency_p95', 'error_rate']).optional(),
  detection_method: z.enum(PERSISTED_ANOMALY_DETECTORS).optional(),
  /**
   * Typed z-score for anomaly insights (#1308). Replaces regex-scraping the
   * value out of `description`. NULL for records that never carried a z-score
   * (isolation-forest, threshold, prediction, error-rate-only trace anomalies).
   * pg returns NUMERIC as a string, so coerce on read.
   */
  z_score: z.coerce.number().nullable().optional(),
  /**
   * When set, this insight collapses multiple co-occurring signals (e.g.
   * latency p95 + error-rate spiking in the same minute for the same
   * service). The legacy `metric_type` field still carries the dominant /
   * primary signal so existing signature derivation keeps working;
   * `dimensions` carries the full multi-signal payload for richer UI
   * rendering. Single-dimension records have `dimensions === undefined`.
   */
  dimensions: z.array(AnomalyDimensionSchema).optional(),
});

export type Insight = z.infer<typeof InsightSchema>;
