import { z } from 'zod/v4';

export const MetricSchema = z.object({
  id: z.number(),
  endpoint_id: z.number(),
  container_id: z.string(),
  container_name: z.string(),
  metric_type: z.enum(['cpu', 'memory', 'memory_bytes']),
  value: z.number(),
  timestamp: z.string(),
});

export const AnomalyDetectionSchema = z.object({
  container_id: z.string(),
  container_name: z.string(),
  metric_type: z.string(),
  current_value: z.number(),
  mean: z.number(),
  std_dev: z.number(),
  z_score: z.number().or(z.literal(Infinity)).or(z.literal(-Infinity)),
  is_anomalous: z.boolean(),
  threshold: z.number(),
  timestamp: z.string(),
  method: z.enum(['zscore', 'bollinger', 'adaptive', 'isolation-forest']).optional(),
});

export type Metric = z.infer<typeof MetricSchema>;
export type AnomalyDetection = z.infer<typeof AnomalyDetectionSchema>;
