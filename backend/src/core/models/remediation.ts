import { z } from 'zod';

export const ActionStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'executing',
  'completed',
  'failed',
]);

export const ActionSchema = z.object({
  id: z.string(),
  insight_id: z.string().nullable(),
  endpoint_id: z.number(),
  container_id: z.string(),
  container_name: z.string(),
  action_type: z.string(),
  rationale: z.string(),
  status: ActionStatusSchema,
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  rejected_by: z.string().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  executed_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  execution_result: z.string().nullable(),
  execution_duration_ms: z.number().nullable(),
  created_at: z.string(),
});

export type ActionStatus = z.infer<typeof ActionStatusSchema>;
export type Action = z.infer<typeof ActionSchema>;
