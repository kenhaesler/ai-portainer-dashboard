import { z } from 'zod/v4';

export const InvestigationStatusSchema = z.enum([
  'pending',
  'gathering',
  'analyzing',
  'complete',
  'failed',
]);

export const RecommendedActionSchema = z.object({
  action: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  rationale: z.string().optional(),
});

export const MetricSnapshotSchema = z.object({
  metric_type: z.string(),
  current: z.number(),
  mean: z.number(),
  std_dev: z.number(),
  sample_count: z.number(),
});

export const EvidenceSummarySchema = z.object({
  log_lines_collected: z.number().optional(),
  log_excerpt: z.string().optional(),
  metrics: z.array(MetricSnapshotSchema).optional(),
  related_containers: z.array(z.string()).optional(),
});

export const InvestigationSchema = z.object({
  id: z.string(),
  insight_id: z.string(),
  endpoint_id: z.number().nullable(),
  container_id: z.string().nullable(),
  container_name: z.string().nullable(),
  status: InvestigationStatusSchema,
  evidence_summary: z.string().nullable(),
  root_cause: z.string().nullable(),
  contributing_factors: z.string().nullable(),
  severity_assessment: z.string().nullable(),
  recommended_actions: z.string().nullable(),
  confidence_score: z.number().nullable(),
  analysis_duration_ms: z.number().nullable(),
  llm_model: z.string().nullable(),
  ai_summary: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;
export type EvidenceSummary = z.infer<typeof EvidenceSummarySchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;

export interface InvestigationWithInsight extends Investigation {
  insight_title?: string;
  insight_severity?: string;
  insight_category?: string;
}
