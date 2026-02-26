import { z } from 'zod/v4';

export const ContainerPortSchema = z.object({
  private: z.number().optional(),
  public: z.number().optional(),
  type: z.string().optional(),
});

export const NormalizedContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  endpointId: z.number(),
  endpointName: z.string(),
  ports: z.array(ContainerPortSchema),
  created: z.number(),
  labels: z.record(z.string(), z.string()),
  networks: z.array(z.string()),
  healthStatus: z.string().optional(),
});

export type ContainerPort = z.infer<typeof ContainerPortSchema>;
export type NormalizedContainer = z.infer<typeof NormalizedContainerSchema>;
