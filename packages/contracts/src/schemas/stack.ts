import { z } from 'zod/v4';

/** Shared vocabulary for Portainer stack lifecycle states, including 2.45. */
export const STACK_STATUSES = ['active', 'inactive', 'deploying', 'error', 'unknown'] as const;
export const StackStatusSchema = z.enum(STACK_STATUSES);
export type StackStatus = z.infer<typeof StackStatusSchema>;
