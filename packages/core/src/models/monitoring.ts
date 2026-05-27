import { z } from 'zod/v4';

/**
 * Per-signal payload carried by `Insight.dimensions` when an anomaly fires
 * for the same `(service, minute)` window across more than one dimension
 * (e.g. trace-anomaly's correlated p95-latency + error-rate suppression — see
 * `packages/ai-intelligence/src/services/trace-anomaly.ts` and issue #1296).
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

export const InsightSchema = z.object({
  id: z.string(),
  endpoint_id: z.number().nullable(),
  endpoint_name: z.string().nullable(),
  container_id: z.string().nullable(),
  container_name: z.string().nullable(),
  severity: z.enum(['critical', 'warning', 'info']),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  suggested_action: z.string().nullable(),
  is_acknowledged: z.number().default(0),
  created_at: z.string(),
  metric_type: z.enum(['cpu', 'memory', 'disk', 'network', 'restart', 'latency_p95', 'error_rate']).optional(),
  detection_method: z
    .enum(['threshold', 'ml-anomaly', 'prediction', 'health-check', 'log-pattern', 'security-scan'])
    .optional(),
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
