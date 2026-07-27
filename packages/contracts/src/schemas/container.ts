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

/**
 * The complete container-state vocabulary, and the only one any surface may
 * compare against.
 *
 * This used to be a bare `z.string()` here and a hand-written union in
 * `@dashboard/core`'s `portainer-normalizers.ts`. Two copies of a vocabulary
 * drift, and this one did: the frontend's fleet-health tile compared against
 * `'exited'` — Docker's word, which the normalizer maps to `'stopped'` before
 * anything downstream sees it — so the stopped count was pinned at 0 while
 * containers were genuinely down. Nothing caught it, because the tile's own
 * tests built their fixtures from the same wrong word.
 *
 * Keep this the single source. `normalizeContainer` maps every Docker state
 * into it (unrecognised input falls through to `'unknown'`), so the enum is
 * total and safe to use as a response serializer.
 */
export const CONTAINER_STATES = ['running', 'stopped', 'paused', 'dead', 'unknown'] as const;

export const ContainerStateSchema = z.enum(CONTAINER_STATES);

export const NormalizedContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: ContainerStateSchema,
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
export type ContainerState = z.infer<typeof ContainerStateSchema>;
export type NormalizedContainer = z.infer<typeof NormalizedContainerSchema>;
