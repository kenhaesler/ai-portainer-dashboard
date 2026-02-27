import { z } from 'zod/v4';

export const MetricTypeSchema = z.enum(['cpu', 'memory', 'memory_bytes']);
export type MetricType = z.infer<typeof MetricTypeSchema>;

export const AnomalyMethodSchema = z.enum(['zscore', 'bollinger', 'adaptive', 'isolation-forest']);
export type AnomalyMethod = z.infer<typeof AnomalyMethodSchema>;

export const MetricSchema = z.object({
  id: z.number(),
  endpoint_id: z.number(),
  container_id: z.string(),
  container_name: z.string(),
  metric_type: MetricTypeSchema,
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
  /** z-score value; Infinity/-Infinity are valid sentinel values for zero-variance samples */
  z_score: z.number().or(z.literal(Infinity)).or(z.literal(-Infinity)),
  is_anomalous: z.boolean(),
  threshold: z.number(),
  timestamp: z.string(),
  method: AnomalyMethodSchema.optional(),
});

export type Metric = z.infer<typeof MetricSchema>;
export type AnomalyDetection = z.infer<typeof AnomalyDetectionSchema>;

/** Result of a moving average calculation over a container metric window. */
export interface MovingAverageResult {
  mean: number;
  std_dev: number;
  sample_count: number;
}

/** Capacity forecast for a container metric. */
export interface CapacityForecast {
  containerId: string;
  containerName: string;
  metricType: string;
  currentValue: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  r_squared: number;
  timeToThreshold: number | null;
  confidence: 'high' | 'medium' | 'low';
}
