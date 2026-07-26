import { z } from 'zod/v4';

export const ContainerPortSchema = z.object({
  private: z.number().optional(),
  public: z.number().optional(),
  type: z.string().optional(),
  /**
   * Docker's host-side bind address for the mapping (`0.0.0.0`, `127.0.0.1`,
   * `::`, …). Required in the response contract: this schema is used as a
   * Fastify serializer, so an absent field here is silently stripped from the
   * payload — which is how the UI ended up hardcoding `0.0.0.0`. Undefined when
   * Docker reported no bind address (exposed but unpublished).
   */
  ip: z.string().optional(),
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
  networkIPs: z.record(z.string(), z.string()),
  healthStatus: z.string().optional(),
});

export type ContainerPort = z.infer<typeof ContainerPortSchema>;
export type NormalizedContainer = z.infer<typeof NormalizedContainerSchema>;
