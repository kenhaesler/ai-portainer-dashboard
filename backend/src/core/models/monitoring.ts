import { z } from 'zod/v4';

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
});

export type Insight = z.infer<typeof InsightSchema>;
