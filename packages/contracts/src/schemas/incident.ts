import { z } from 'zod/v4';

export const CorrelationConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type CorrelationConfidence = z.infer<typeof CorrelationConfidenceSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  status: z.enum(['active', 'resolved']),
  root_cause_insight_id: z.string().nullable(),
  related_insight_ids: z.array(z.string()),
  affected_containers: z.array(z.string()),
  endpoint_id: z.number().nullable(),
  endpoint_name: z.string().nullable(),
  correlation_type: z.string(),
  correlation_confidence: CorrelationConfidenceSchema,
  insight_count: z.number(),
  summary: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
});

export const IncidentInsertSchema = IncidentSchema.omit({
  status: true,
  created_at: true,
  updated_at: true,
  resolved_at: true,
});

export type Incident = z.infer<typeof IncidentSchema>;
export type IncidentInsert = z.infer<typeof IncidentInsertSchema>;
