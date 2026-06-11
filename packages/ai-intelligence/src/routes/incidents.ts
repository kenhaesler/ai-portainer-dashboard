import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { FastifyInstance } from 'fastify';
import { getIncidents, getIncident, resolveIncident, getIncidentCount, getIncidentGroups, resolveIncidentsBatch } from '../services/incident-store.js';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { cachedFetchSWR, getCacheKey, cache } from '@dashboard/core/portainer/portainer-cache.js';
import { z } from 'zod';

export async function incidentsRoutes(fastify: FastifyInstance) {
  // Bounded query schema — without this, limit/offset were read via a raw cast
  // with no coercion or bounds, so `?limit=100000000` returned the entire table
  // (unbounded pagination DoS, made worse because GETs bypass the rate limiter).
  const ListQ = z.object({
    status: z.enum(['active', 'resolved']).optional(),
    severity: z.enum(['critical', 'warning', 'info']).optional(),
    signature: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  // List incidents
  fastify.get('/api/incidents', {
    schema: {
      tags: ['Incidents'],
      summary: 'List correlated incidents',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    // Validate via safeParse (mirrors /api/incidents/groups in this file) so the
    // route does not depend on a Zod validator compiler being registered.
    const parsed = ListQ.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.flatten() });
    }
    const { status, severity, signature, limit, offset } = parsed.data;

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
  const GroupsQ = z.object({
    status: z.enum(['active', 'resolved']).optional(),
    endpoint_id: z.coerce.number().int().optional(),
    since: z.enum(['1h', '24h', '7d']).optional(),
    severity: z.enum(['critical', 'warning', 'info']).optional(),
  });

  fastify.get('/api/incidents/groups', {
    schema: {
      tags: ['Incidents'],
      summary: 'List active incidents grouped by signature',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = GroupsQ.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.flatten() });
    }
    const { status = 'active', endpoint_id: epId, since, severity } = parsed.data;
    const since_minutes = since === '1h' ? 60 : since === '24h' ? 1440 : since === '7d' ? 10080 : undefined;
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

  // Resolve a batch of incidents
  fastify.post('/api/incidents/resolve', {
    schema: {
      tags: ['Incidents'],
      summary: 'Resolve a batch of incidents',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 500 },
        },
        required: ['ids'],
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    }
    const result = await resolveIncidentsBatch(parsed.data.ids);
    await cache.invalidatePattern('incidents-groups').catch(() => undefined);
    return result;
  });
}
