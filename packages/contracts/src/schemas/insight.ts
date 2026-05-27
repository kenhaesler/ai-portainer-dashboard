import { z } from 'zod/v4';

export const SeveritySchema = z.enum(['critical', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Per-signal payload carried by `Insight.dimensions` when an anomaly fires
 * for the same `(service, minute)` window across more than one dimension
 * (e.g. trace-anomaly's correlated p95-latency + error-rate suppression —
 * see #1296). Single-dimension records leave `dimensions` undefined.
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
  severity: SeveritySchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
  suggested_action: z.string().nullable(),
  is_acknowledged: z.number().default(0),
  created_at: z.string(),
  dimensions: z.array(AnomalyDimensionSchema).optional(),
});

export type Insight = z.infer<typeof InsightSchema>;
