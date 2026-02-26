import { z } from 'zod/v4';

export const NormalizedEndpointSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  url: z.string(),
  status: z.string(),
  containersRunning: z.number(),
  containersStopped: z.number(),
  containersHealthy: z.number(),
  containersUnhealthy: z.number(),
  totalContainers: z.number(),
  stackCount: z.number(),
  agentVersion: z.string().optional(),
});

export type NormalizedEndpoint = z.infer<typeof NormalizedEndpointSchema>;
