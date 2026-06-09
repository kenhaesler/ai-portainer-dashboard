import { FastifyInstance } from 'fastify';
import { z } from 'zod';

export interface SystemInfoRoutesOpts {
  /**
   * Product version, read from the composition-root package.json at startup
   * and passed in by the caller (the route itself does no filesystem access).
   */
  appVersion: string;
}

/**
 * Key component versions surfaced in the General → System Information panel.
 * Each value comes from its authoritative source: `app` is injected from the
 * product package.json, `node`/`fastify` are read from the running process.
 * React's version is reported client-side and is not part of this payload.
 */
const SystemInfoResponseSchema = z.object({
  app: z.string(),
  node: z.string(),
  fastify: z.string(),
});

export async function systemInfoRoutes(
  fastify: FastifyInstance,
  opts: SystemInfoRoutesOpts,
) {
  // Admin-gated: version strings are mild infrastructure disclosure, so this
  // matches the other /api/admin/* reads (e.g. cache stats).
  fastify.get('/api/admin/system-info', {
    schema: {
      tags: ['System'],
      summary: 'Key component versions (Node.js, app, Fastify)',
      security: [{ bearerAuth: [] }],
      response: { 200: SystemInfoResponseSchema },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => ({
    app: opts.appVersion,
    node: process.versions.node,
    fastify: fastify.version,
  }));
}
