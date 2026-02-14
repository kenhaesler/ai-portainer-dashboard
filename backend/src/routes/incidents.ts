import { FastifyInstance } from 'fastify';
import { getIncidents, getIncident, resolveIncident, getIncidentCount } from '../services/incident-store.js';
import { getDbForDomain } from '../db/app-db-router.js';

export async function incidentsRoutes(fastify: FastifyInstance) {
  // List incidents
  fastify.get('/api/incidents', {
    schema: {
      tags: ['Incidents'],
      summary: 'List correlated incidents',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { status, severity, limit = 50, offset = 0 } = request.query as {
      status?: 'active' | 'resolved';
      severity?: string;
      limit?: number;
      offset?: number;
    };

    const incidents = await getIncidents({ status, severity, limit, offset });
    const counts = await getIncidentCount();

    return {
      incidents,
      counts,
      limit,
      offset,
    };
  });

  // Get single incident with related insights
  fastify.get('/api/incidents/:id', {
    schema: {
      tags: ['Incidents'],
      summary: 'Get incident details with related insights',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    // Fetch related insights
    const relatedIds: string[] = JSON.parse(incident.related_insight_ids);
    const allIds = incident.root_cause_insight_id
      ? [incident.root_cause_insight_id, ...relatedIds]
      : relatedIds;

    let relatedInsights: unknown[] = [];
    if (allIds.length > 0) {
      const db = getDbForDomain('insights');
      const placeholders = allIds.map(() => '?').join(',');
      relatedInsights = await db.query(
        `SELECT * FROM insights WHERE id IN (${placeholders}) ORDER BY created_at ASC`,
        allIds,
      );
    }

    return {
      ...incident,
      relatedInsights,
    };
  });

  // Resolve an incident
  fastify.post('/api/incidents/:id/resolve', {
    schema: {
      tags: ['Incidents'],
      summary: 'Resolve an incident',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    await resolveIncident(id);
    return { success: true };
  });
}
