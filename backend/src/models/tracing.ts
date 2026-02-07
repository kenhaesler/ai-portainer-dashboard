import { z } from 'zod';

export const SpanKindSchema = z.enum(['client', 'server', 'internal']);
export const SpanStatusSchema = z.enum(['ok', 'error', 'unset']);

export const SpanSchema = z.object({
  id: z.string(),
  trace_id: z.string(),
  parent_span_id: z.string().nullable(),
  name: z.string(),
  kind: SpanKindSchema,
  status: SpanStatusSchema,
  start_time: z.string(),
  end_time: z.string().nullable(),
  duration_ms: z.number().nullable(),
  service_name: z.string(),
  attributes: z.string().default('{}'),
  trace_source: z.string().optional(),
  created_at: z.string(),
});

export const ServiceMapNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  callCount: z.number(),
  avgDuration: z.number(),
  errorRate: z.number(),
});

export const ServiceMapEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  callCount: z.number(),
  avgDuration: z.number(),
});

export type Span = z.infer<typeof SpanSchema>;
export type ServiceMapNode = z.infer<typeof ServiceMapNodeSchema>;
export type ServiceMapEdge = z.infer<typeof ServiceMapEdgeSchema>;
