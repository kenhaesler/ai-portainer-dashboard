import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { aggregateObservedDestinations } from '../services/observed-destinations.js';

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Routes for the Security Audit "Observed Destinations" panel (#1240).
 *
 * Aggregates outbound destinations captured by Beyla over the requested
 * window and classifies each one against the security_destination_rules
 * table. Admin-only because the verdict logic (and the underlying rule
 * store) feeds security decisions; non-admins must not be able to enumerate
 * the destination inventory of a deployment.
 */
export async function observedDestinationsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/security/observed-destinations', {
    schema: {
      tags: ['Security'],
      summary: 'List observed outbound destinations with allow/warn/deny verdicts',
      security: [{ bearerAuth: [] }],
      querystring: QuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const q = request.query as z.infer<typeof QuerySchema>;
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const destinations = await aggregateObservedDestinations({ from, to });
    return { destinations };
  });
}
