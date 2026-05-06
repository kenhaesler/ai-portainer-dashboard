import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { FastifyInstance } from 'fastify';
import { getIncidents, getIncident, resolveIncident, getIncidentCount, getIncidentGroups } from '../services/incident-store.js';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { cachedFetchSWR, getCacheKey, cache } from '@dashboard/core/portainer/portainer-cache.js';

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
    const { status, severity, signature, limit = 50, offset = 0 } = request.query as {
      status?: 'active' | 'resolved';
      severity?: string;
      signature?: string;
      limit?: number;
      offset?: number;
    };

    const incidents = await getIncidents({ status, severity, signature, limit, offset });
    const counts = await getIncidentCount();

    return {
      incidents,
      counts,
      limit,
      offset,
    };
  });

  // List active incidents grouped by signature
  fastify.get('/api/incidents/groups', {
    schema: {
      tags: ['Incidents'],
      summary: 'List active incidents grouped by signature',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { status = 'active', endpoint_id, since, severity } = request.query as {
      status?: 'active' | 'resolved';
      endpoint_id?: string;
      since?: '1h' | '24h' | '7d';
      severity?: 'critical' | 'warning' | 'info';
    };
    const since_minutes = since === '1h' ? 60 : since === '24h' ? 1440 : since === '7d' ? 10080 : undefined;
    const epId = endpoint_id != null ? Number(endpoint_id) : undefined;

    const cacheKey = getCacheKey('incidents-groups', status, epId ?? 'all', since ?? 'all', severity ?? 'all');
    return cachedFetchSWR(cacheKey, 10, () =>
      getIncidentGroups({ status, endpoint_id: epId, since_minutes, severity }),
    );
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
    const relatedIds: string[] = incident.related_insight_ids;
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
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    await resolveIncident(id);
    // Invalidate grouped-incidents cache so the next request reflects the resolved state.
    // invalidatePattern matches all variants (by status, endpoint_id, since, severity).
    await cache.invalidatePattern('incidents-groups').catch(() => undefined);
    return { success: true };
  });
}
