import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { getKpiHistory } from '../services/kpi-store.js';

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/dashboard/summary', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get dashboard summary with KPIs',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );

    const normalized = endpoints.map(normalizeEndpoint);

    const totals = normalized.reduce(
      (acc, ep) => ({
        endpoints: acc.endpoints + 1,
        endpointsUp: acc.endpointsUp + (ep.status === 'up' ? 1 : 0),
        endpointsDown: acc.endpointsDown + (ep.status === 'down' ? 1 : 0),
        running: acc.running + ep.containersRunning,
        stopped: acc.stopped + ep.containersStopped,
        healthy: acc.healthy + ep.containersHealthy,
        unhealthy: acc.unhealthy + ep.containersUnhealthy,
        total: acc.total + ep.totalContainers,
        stacks: acc.stacks + ep.stackCount,
      }),
      {
        endpoints: 0,
        endpointsUp: 0,
        endpointsDown: 0,
        running: 0,
        stopped: 0,
        healthy: 0,
        unhealthy: 0,
        total: 0,
        stacks: 0,
      },
    );

    // Get recent containers from first few endpoints
    const recentContainers = [];
    for (const ep of normalized.filter((e) => e.status === 'up').slice(0, 5)) {
      try {
        const containers = await cachedFetch(
          getCacheKey('containers', ep.id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.id),
        );
        const norm = containers.map((c) => normalizeContainer(c, ep.id, ep.name));
        recentContainers.push(...norm);
      } catch {
        // Skip endpoints that fail
      }
    }

    // Sort by created time, take latest 20
    recentContainers.sort((a, b) => b.created - a.created);

    return {
      kpis: totals,
      endpoints: normalized,
      recentContainers: recentContainers.slice(0, 20),
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/api/dashboard/kpi-history', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get KPI history for sparklines (last 24h)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          hours: { type: 'number', default: 24 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { hours = 24 } = request.query as { hours?: number };
    const snapshots = getKpiHistory(Math.min(hours, 168)); // Cap at 7 days
    return { snapshots };
  });
}
