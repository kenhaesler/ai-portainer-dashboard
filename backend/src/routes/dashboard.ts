import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as portainer from '../services/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { getKpiHistory } from '../services/kpi-store.js';
import { createChildLogger } from '../utils/logger.js';
import { buildSecurityAuditSummary, getSecurityAudit } from '../services/security-audit.js';

const log = createChildLogger('route:dashboard');

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/dashboard/summary', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get dashboard summary with KPIs',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        recentLimit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    let endpoints;
    try {
      endpoints = await cachedFetchSWR(
        getCacheKey('endpoints'),
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({
        error: 'Unable to connect to Portainer',
        details: msg,
      });
    }

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

    const { recentLimit } = request.query as { recentLimit: number };

    // Get recent containers from all up endpoints (parallel)
    const recentContainers = [];
    const errors: string[] = [];
    const upEndpoints = normalized.filter((e) => e.status === 'up');
    const settled = await Promise.allSettled(
      upEndpoints.map((ep) =>
        cachedFetchSWR(
          getCacheKey('containers', ep.id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.id),
        ).then((containers) => ({ ep, containers })),
      ),
    );
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        const { ep, containers } = result.value;
        recentContainers.push(...containers.map((c) => normalizeContainer(c, ep.id, ep.name)));
      } else {
        const ep = upEndpoints[i];
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        log.warn({ endpointId: ep.id, endpointName: ep.name, err: result.reason }, 'Failed to fetch containers for endpoint');
        errors.push(`${ep.name}: ${msg}`);
      }
    }

    if (upEndpoints.length > 0 && recentContainers.length === 0 && errors.length > 0) {
      // Degrade gracefully: home can still render KPIs/endpoints/security while
      // recent container samples are temporarily unavailable.
      log.warn({ errors, endpointCount: upEndpoints.length }, 'Dashboard summary has no recent containers due to upstream errors');
    }

    // Sort by created time, take latest N
    recentContainers.sort((a, b) => b.created - a.created);

    let security = { totalAudited: 0, flagged: 0, ignored: 0 };
    try {
      const auditEntries = await getSecurityAudit();
      security = buildSecurityAuditSummary(auditEntries);
    } catch (err) {
      log.warn({ err }, 'Failed to fetch security audit summary');
    }

    return {
      kpis: totals,
      security,
      recentContainers: recentContainers.slice(0, recentLimit),
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/api/dashboard/kpi-history', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get KPI history for sparklines (last 24h)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        hours: z.coerce.number().default(24),
      }),
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { hours = 24 } = request.query as { hours?: number };
    const safeHours = Number.isFinite(hours) ? Math.max(1, Math.min(hours, 168)) : 24;

    try {
      const snapshots = await getKpiHistory(safeHours); // Cap at 7 days
      return { snapshots };
    } catch (err) {
      log.error({ err }, 'Failed to fetch KPI history');
      // Keep dashboard pages functional even when KPI snapshot storage is unavailable.
      return { snapshots: [] };
    }
  });
}
