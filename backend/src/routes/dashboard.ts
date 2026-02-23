import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as portainer from '../core/portainer/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../core/portainer/portainer-cache.js';
import { normalizeEndpoint, normalizeContainer } from '../core/portainer/portainer-normalizers.js';
import { getKpiHistory } from '../services/kpi-store.js';
import { createChildLogger } from '../core/utils/logger.js';
import { buildSecurityAuditSummary, getSecurityAudit } from '../services/security-audit.js';
import { getLatestMetricsBatch } from '../services/metrics-store.js';

const log = createChildLogger('route:dashboard');

/** Measure the wall-clock duration of an async operation for Server-Timing. */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; dur: number }> {
  const start = performance.now();
  const result = await fn();
  const dur = Math.round((performance.now() - start) * 100) / 100;
  return { result, dur };
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/dashboard/summary', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get dashboard summary with KPIs',
      security: [{ bearerAuth: [] }],
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

  fastify.get('/api/dashboard/resources', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get fleet-wide resource usage and top stacks by resource consumption',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        topN: z.coerce.number().int().min(1).max(20).default(10),
      }),
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { topN } = request.query as { topN: number };

    // Get all endpoints
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
    const upEndpoints = normalized.filter((e) => e.status === 'up');

    // Get all containers from all up endpoints
    const allContainers: Array<{ container: any; endpointId: number; endpointName: string }> = [];
    const resourceErrors: string[] = [];
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
        allContainers.push(...containers.map((c) => ({
          container: normalizeContainer(c, ep.id, ep.name),
          endpointId: ep.id,
          endpointName: ep.name,
        })));
      } else {
        const ep = upEndpoints[i];
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        log.warn({ endpointId: ep.id, endpointName: ep.name, err: result.reason }, 'Failed to fetch containers for endpoint');
        resourceErrors.push(`${ep.name}: ${msg}`);
      }
    }

    // Read latest metrics from TimescaleDB (collected by the scheduler every 60s)
    // instead of hitting Portainer's stats API for every running container.
    const runningContainers = allContainers.filter((c) => c.container.state === 'running');
    const runningContainerIds = runningContainers.map((c) => c.container.id);

    let storedMetrics = new Map<string, Record<string, number>>();
    try {
      storedMetrics = await getLatestMetricsBatch(runningContainerIds);
    } catch (err) {
      log.warn({ err }, 'Failed to read stored metrics from TimescaleDB, resource data will be empty');
    }

    // Aggregate fleet-wide CPU/memory
    let totalCpuPercent = 0;
    let totalMemoryPercent = 0;
    let statsCount = 0;

    const containerMetrics = new Map<string, { cpu: number; memory: number; memoryBytes: number }>();

    for (const { container } of runningContainers) {
      const metrics = storedMetrics.get(container.id);
      if (metrics && (metrics.cpu !== undefined || metrics.memory !== undefined)) {
        const cpu = metrics.cpu ?? 0;
        const memory = metrics.memory ?? 0;
        const memoryBytes = metrics.memory_bytes ?? 0;
        containerMetrics.set(container.id, { cpu, memory, memoryBytes });
        totalCpuPercent += cpu;
        totalMemoryPercent += memory;
        statsCount++;
      }
    }

    const fleetCpuPercent = statsCount > 0 ? Math.round((totalCpuPercent / statsCount) * 100) / 100 : 0;
    const fleetMemoryPercent = statsCount > 0 ? Math.round((totalMemoryPercent / statsCount) * 100) / 100 : 0;

    // Group containers by stack and aggregate
    const stackMap = new Map<string, {
      containerCount: number;
      runningCount: number;
      stoppedCount: number;
      cpuPercent: number;
      memoryPercent: number;
      memoryBytes: number;
    }>();

    for (const { container } of allContainers) {
      const stackName = container.labels['com.docker.compose.project'] || 'No Stack';

      if (!stackMap.has(stackName)) {
        stackMap.set(stackName, {
          containerCount: 0,
          runningCount: 0,
          stoppedCount: 0,
          cpuPercent: 0,
          memoryPercent: 0,
          memoryBytes: 0,
        });
      }

      const stack = stackMap.get(stackName)!;
      stack.containerCount++;
      if (container.state === 'running') {
        stack.runningCount++;
        const metrics = containerMetrics.get(container.id);
        if (metrics) {
          stack.cpuPercent += metrics.cpu;
          stack.memoryPercent += metrics.memory;
          stack.memoryBytes += metrics.memoryBytes;
        }
      } else if (container.state === 'stopped') {
        stack.stoppedCount++;
      }
    }

    // Convert to array and calculate averages
    const stacks = Array.from(stackMap.entries()).map(([name, stats]) => ({
      name,
      containerCount: stats.containerCount,
      runningCount: stats.runningCount,
      stoppedCount: stats.stoppedCount,
      cpuPercent: stats.runningCount > 0
        ? Math.round((stats.cpuPercent / stats.runningCount) * 100) / 100
        : 0,
      memoryPercent: stats.runningCount > 0
        ? Math.round((stats.memoryPercent / stats.runningCount) * 100) / 100
        : 0,
      memoryBytes: stats.memoryBytes,
    }));

    // Sort by total resource usage (CPU + Memory combined) and take top N
    stacks.sort((a, b) => {
      const aTotal = a.cpuPercent + a.memoryPercent;
      const bTotal = b.cpuPercent + b.memoryPercent;
      return bTotal - aTotal;
    });

    const topStacks = stacks.slice(0, topN);
    const resourcePartial = resourceErrors.length > 0;

    return {
      fleetCpuPercent,
      fleetMemoryPercent,
      topStacks,
      ...(resourcePartial ? { partial: true, failedEndpoints: resourceErrors } : {}),
    };
  });

  // Unified endpoint: returns summary + resources in a single request to reduce
  // redundant frontend fetches. Both sub-responses share the same endpoint/container
  // data so only one Portainer round-trip is needed instead of two.
  fastify.get('/api/dashboard/full', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get combined dashboard summary + resources in one request',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        topN: z.coerce.number().int().min(1).max(20).default(10),
        kpiHistoryHours: z.coerce.number().int().min(0).max(168).default(0),
      }),
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { topN, kpiHistoryHours } = request.query as { topN: number; kpiHistoryHours: number };
    const routeStart = performance.now();

    // --- Shared data: fetch endpoints + containers once ---
    // Start security audit immediately in parallel — it fetches from the same
    // shared cache but doesn't depend on container data from this handler.
    const securityAuditPromise = getSecurityAudit().catch((err) => {
      log.warn({ err }, 'Failed to fetch security audit summary');
      return null;
    });

    // Start KPI history fetch in parallel when requested
    const kpiHistoryPromise = kpiHistoryHours > 0
      ? timed('kpi', () =>
          getKpiHistory(kpiHistoryHours).catch((err) => {
            log.warn({ err }, 'Failed to fetch KPI history');
            return [];
          }),
        )
      : null;

    let rawEndpoints;
    const endpointTiming = await timed('endpoints', async () => {
      try {
        return await cachedFetchSWR(
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
    });
    // If reply was already sent (502), endpointTiming.result is the reply
    if (reply.sent) return;
    rawEndpoints = endpointTiming.result;

    const normalized = rawEndpoints.map(normalizeEndpoint);
    const upEndpoints = normalized.filter((e) => e.status === 'up');

    // Fetch all containers + build resources (timed as a single block)
    const resourcesTiming = await timed('resources', async () => {
      const allNormalizedContainers: Array<{ container: any; endpointId: number; endpointName: string }> = [];
      const errors: string[] = [];
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
          allNormalizedContainers.push(...containers.map((c) => ({
            container: normalizeContainer(c, ep.id, ep.name),
            endpointId: ep.id,
            endpointName: ep.name,
          })));
        } else {
          const ep = upEndpoints[i];
          const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
          log.warn({ endpointId: ep.id, endpointName: ep.name, err: result.reason }, 'Failed to fetch containers for endpoint');
          errors.push(`${ep.name}: ${msg}`);
        }
      }

      // --- Build summary ---
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

      // --- Build resources ---
      const runningContainers = allNormalizedContainers.filter((c) => c.container.state === 'running');
      const runningContainerIds = runningContainers.map((c) => c.container.id);

      // Run security audit (already in flight) and metrics batch in parallel
      const [auditEntries, storedMetrics] = await Promise.all([
        securityAuditPromise,
        getLatestMetricsBatch(runningContainerIds).catch((err) => {
          log.warn({ err }, 'Failed to read stored metrics from TimescaleDB, resource data will be empty');
          return new Map<string, Record<string, number>>();
        }),
      ]);

      const security = auditEntries
        ? buildSecurityAuditSummary(auditEntries)
        : { totalAudited: 0, flagged: 0, ignored: 0 };

      let totalCpuPercent = 0;
      let totalMemoryPercent = 0;
      let statsCount = 0;
      const containerMetrics = new Map<string, { cpu: number; memory: number; memoryBytes: number }>();

      for (const { container } of runningContainers) {
        const metrics = storedMetrics.get(container.id);
        if (metrics && (metrics.cpu !== undefined || metrics.memory !== undefined)) {
          const cpu = metrics.cpu ?? 0;
          const memory = metrics.memory ?? 0;
          const memoryBytes = metrics.memory_bytes ?? 0;
          containerMetrics.set(container.id, { cpu, memory, memoryBytes });
          totalCpuPercent += cpu;
          totalMemoryPercent += memory;
          statsCount++;
        }
      }

      const fleetCpuPercent = statsCount > 0 ? Math.round((totalCpuPercent / statsCount) * 100) / 100 : 0;
      const fleetMemoryPercent = statsCount > 0 ? Math.round((totalMemoryPercent / statsCount) * 100) / 100 : 0;

      const stackMap = new Map<string, {
        containerCount: number;
        runningCount: number;
        stoppedCount: number;
        cpuPercent: number;
        memoryPercent: number;
        memoryBytes: number;
      }>();

      for (const { container } of allNormalizedContainers) {
        const stackName = container.labels['com.docker.compose.project'] || 'No Stack';
        if (!stackMap.has(stackName)) {
          stackMap.set(stackName, {
            containerCount: 0,
            runningCount: 0,
            stoppedCount: 0,
            cpuPercent: 0,
            memoryPercent: 0,
            memoryBytes: 0,
          });
        }
        const stack = stackMap.get(stackName)!;
        stack.containerCount++;
        if (container.state === 'running') {
          stack.runningCount++;
          const m = containerMetrics.get(container.id);
          if (m) {
            stack.cpuPercent += m.cpu;
            stack.memoryPercent += m.memory;
            stack.memoryBytes += m.memoryBytes;
          }
        } else if (container.state === 'stopped') {
          stack.stoppedCount++;
        }
      }

      const stacks = Array.from(stackMap.entries())
        .map(([name, stats]) => ({
          name,
          containerCount: stats.containerCount,
          runningCount: stats.runningCount,
          stoppedCount: stats.stoppedCount,
          cpuPercent: stats.runningCount > 0
            ? Math.round((stats.cpuPercent / stats.runningCount) * 100) / 100
            : 0,
          memoryPercent: stats.runningCount > 0
            ? Math.round((stats.memoryPercent / stats.runningCount) * 100) / 100
            : 0,
          memoryBytes: stats.memoryBytes,
        }))
        .sort((a, b) => (b.cpuPercent + b.memoryPercent) - (a.cpuPercent + a.memoryPercent))
        .slice(0, topN);

      return { totals, security, fleetCpuPercent, fleetMemoryPercent, stacks, errors };
    });

    const { totals, security, fleetCpuPercent, fleetMemoryPercent, stacks, errors } = resourcesTiming.result;

    // Resolve KPI history (already in flight)
    const kpiResult = kpiHistoryPromise ? await kpiHistoryPromise : null;

    // Build Server-Timing header
    const totalDur = Math.round((performance.now() - routeStart) * 100) / 100;
    const timingParts = [
      `endpoints;dur=${endpointTiming.dur}`,
      `resources;dur=${resourcesTiming.dur}`,
      ...(kpiResult ? [`kpi;dur=${kpiResult.dur}`] : []),
      `total;dur=${totalDur}`,
    ];
    reply.header('Server-Timing', timingParts.join(','));

    const partial = errors.length > 0;

    return {
      summary: {
        kpis: totals,
        security,
        timestamp: new Date().toISOString(),
      },
      resources: {
        fleetCpuPercent,
        fleetMemoryPercent,
        topStacks: stacks,
      },
      endpoints: normalized,
      ...(kpiResult ? { kpiHistory: kpiResult.result } : {}),
      ...(partial ? { partial, failedEndpoints: errors } : {}),
    };
  });
}
