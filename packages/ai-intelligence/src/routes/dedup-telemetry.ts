/**
 * Routes for the dedup-engine telemetry collected by the hourly job in
 * services/dedup-telemetry.ts. Admin-only — emission rates per detector
 * are sensitive enough that we'd rather not advertise them on a public
 * endpoint.
 */
import '@dashboard/core/plugins/auth.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';

const ListQ = z.object({
  /** Max rows to return. Defaults to the most recent 200. */
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  /** Filter to a single signature (e.g. anomaly:threshold:cpu). */
  signature: z.string().min(1).max(200).optional(),
});

interface MetricRow {
  collected_at: string;
  window_hours: number;
  signature: string;
  total_insights: number;
  distinct_containers: number;
  alerts_per_container: number;
  total_incidents: number;
  avg_insights_per_incident: number;
}

export async function dedupTelemetryRoutes(fastify: FastifyInstance) {
  fastify.get('/api/dedup-telemetry', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Latest per-signature dedup metrics (admin-only)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const parsed = ListQ.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.flatten() });
    }
    const { limit = 200, signature } = parsed.data;

    const db = getDbForDomain('monitoring');
    let rows: MetricRow[];
    if (signature) {
      rows = await db.query<MetricRow>(
        `SELECT collected_at, window_hours, signature,
                total_insights, distinct_containers, alerts_per_container,
                total_incidents, avg_insights_per_incident
         FROM monitoring_dedup_metrics
         WHERE signature = ?
         ORDER BY collected_at DESC
         LIMIT ?`,
        [signature, limit],
      );
    } else {
      rows = await db.query<MetricRow>(
        `SELECT collected_at, window_hours, signature,
                total_insights, distinct_containers, alerts_per_container,
                total_incidents, avg_insights_per_incident
         FROM monitoring_dedup_metrics
         ORDER BY collected_at DESC
         LIMIT ?`,
        [limit],
      );
    }

    return { rows };
  });
}
