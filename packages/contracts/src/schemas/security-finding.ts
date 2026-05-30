import { z } from 'zod/v4';
import { SeveritySchema } from './insight.js';

export const SecurityFindingSchema = z.object({
  severity: SeveritySchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
});

export const CapabilityPostureSchema = z.object({
  capAdd: z.array(z.string()),
  privileged: z.boolean(),
  networkMode: z.string().nullable(),
  pidMode: z.string().nullable(),
});

export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;
export type CapabilityPosture = z.infer<typeof CapabilityPostureSchema>;
