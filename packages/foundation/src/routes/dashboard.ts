import { FastifyInstance } from 'fastify';
// Fastify type augmentations (`fastify.authenticate`/`requireRole`,
// `request.user`/`requestId`, swagger `schema.tags`) used to arrive implicitly
// via the domain barrels this file imports; those barrels no longer re-export
// routes (#1533), so import the declaring core plugin modules explicitly.
import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { z } from 'zod/v4';
import pLimit from 'p-limit';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeEndpoint, normalizeContainer, type NormalizedEndpoint, type NormalizedContainer } from '@dashboard/core/portainer/portainer-normalizers.js';
import { enrichEndpointsWithLiveDockerInfo, attachStackCounts, computeFleetTotals } from '@dashboard/core/portainer/live-fleet.js';
import { isDockerEndpoint } from '@dashboard/core/models/portainer.js';
import {
  DashboardSummaryResponseSchema,
  DashboardResourcesResponseSchema,
  DashboardFullResponseSchema,
  KpiHistoryResponseSchema,
  ErrorWithDetailsSchema,
} from '@dashboard/core/models/api-schemas.js';
import { getKpiHistory, getLatestMetricsBatch, getLatestKpiSnapshot } from '@dashboard/observability';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { errorDetails } from '@dashboard/core/plugins/error-handler.js';
import { buildSecurityAuditSummary, getSecurityAudit } from '@dashboard/security';

/**
 * Cap concurrent Portainer API calls per dashboard request to 5.
 * The portainer-client has its own higher process-wide limit (default 30),
 * but dashboard routes fan out across many endpoints simultaneously —
 * this tighter cap prevents a single heavy page-load from saturating the
 * shared pool and starving other routes (containers, stacks, etc.).
 */
const portainerLimit = pLimit(5);

const log = createChildLogger('route:dashboard');

/** Measure the wall-clock duration of an async operation for Server-Timing. */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; dur: number }> {
  const start = performance.now();
  const result = await fn();
  const dur = Math.round((performance.now() - start) * 100) / 100;
  return { result, dur };
}

/**
 * Best-effort fetch of the Portainer stacks list (SWR-cached). A stacks-API
 * failure must never break the dashboard — stack counts just default to 0.
 */
async function fetchStacksSafe(): Promise<import('@dashboard/core/models/portainer.js').Stack[]> {
  try {
    return (await cachedFetchSWR(getCacheKey('stacks'), TTL.STACKS, () => portainer.getStacks())) ?? [];
  } catch (err) {
    log.warn({ err }, 'stacks fetch failed — stack counts default to 0');
    return [];
  }
}

interface FleetStackResources {
  name: string;
  containerCount: number;
  runningCount: number;
  stoppedCount: number;
  cpuPercent: number;
  memoryPercent: number;
  memoryBytes: number;
}

interface FleetResources {
  fleetCpuPercent: number;
  fleetMemoryPercent: number;
  topStacks: FleetStackResources[];
  /** Per-endpoint container-fetch failures, formatted as "<name>: <message>". */
  errors: string[];
  /** Every container fetched from the up Docker endpoints (all states). */
  containers: Array<{ container: NormalizedContainer; endpointId: number; endpointName: string }>;
}

/**
 * Shared fleet-resource aggregation for /api/dashboard/resources and the
 * resources section of /api/dashboard/full (#1543) — exactly one copy of the
 * container fan-out + metrics read + per-stack aggregation so the two routes
 * can never drift.
 *
 * Fans out container fetches across the up Docker endpoints
 * (concurrency-capped, SWR-cached), reads the latest stored metrics from
 * TimescaleDB (collected by the scheduler every 60s — no Portainer stats
 * calls), and aggregates fleet CPU/memory plus the top-N stacks by combined
 * resource usage.
 */
async function buildFleetResources(
  upDockerEndpoints: NormalizedEndpoint[],
  topN: number,
): Promise<FleetResources> {
  const allContainers: FleetResources['containers'] = [];
  const errors: string[] = [];
  const settled = await Promise.allSettled(
    upDockerEndpoints.map((ep) =>
      portainerLimit(() =>
        cachedFetchSWR(
          getCacheKey('containers', ep.id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.id),
        ).then((containers) => ({ ep, containers })),
      ),
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
      const ep = upDockerEndpoints[i];
      const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
      log.warn({ endpointId: ep.id, endpointName: ep.name, err: result.reason }, 'Failed to fetch containers for endpoint');
      errors.push(`${ep.name}: ${msg}`);
    }
  }

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

  // Per-stack averages, sorted by combined CPU + memory usage, top N only.
  const topStacks = Array.from(stackMap.entries())
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

  return { fleetCpuPercent, fleetMemoryPercent, topStacks, errors, containers: allContainers };
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/dashboard/summary', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get dashboard summary with KPIs',
      security: [{ bearerAuth: [] }],
      response: { 200: DashboardSummaryResponseSchema, 502: ErrorWithDetailsSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    // Start security audit immediately — it doesn't depend on endpoints.
    const securityPromise = getSecurityAudit().catch((err) => {
      log.warn({ err }, 'Failed to fetch security audit summary');
      return null;
    });

    let endpoints;
    try {
      endpoints = await cachedFetchSWR(
        getCacheKey('endpoints'),
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      );
    } catch (err) {
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({
        error: 'Unable to connect to Portainer',
        details: errorDetails(err),
      });
    }

    const normalized = endpoints.map(normalizeEndpoint);
    // Live `/docker/info` is the primary source for per-endpoint counts —
    // Portainer's Snapshots[] is no longer read (issue #1249+). Enrichment
    // mutates only counts/totalCpu/totalMemory/snapshotSource — never the
    // status/type fields other stages read — so it runs concurrently with the
    // stacks fetch and the KPI snapshot lookup instead of ahead of them (#1500).
    const [, stacks, latestKpi] = await Promise.all([
      enrichEndpointsWithLiveDockerInfo(normalized),
      fetchStacksSafe(), // stack counts come from the live stacks list (best-effort)
      getLatestKpiSnapshot().catch(() => null),
    ]);
    attachStackCounts(normalized, stacks);

    // /summary stays container-free (#801): pass [] so healthy/unhealthy are
    // 0 placeholders here, then source them from the latest KPI snapshot.
    const base = computeFleetTotals(normalized, [], stacks.length);
    const kpis = {
      ...base,
      healthy: latestKpi?.healthy ?? 0,
      unhealthy: latestKpi?.unhealthy ?? 0,
    };

    // Await security audit that was started in parallel with endpoint fetch.
    const auditEntries = await securityPromise;
    const security = auditEntries
      ? buildSecurityAuditSummary(auditEntries)
      : { totalAudited: 0, flagged: 0, ignored: 0 };

    return {
      kpis,
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
      response: { 200: KpiHistoryResponseSchema },
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
      response: { 200: DashboardResourcesResponseSchema, 502: ErrorWithDetailsSchema },
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
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({
        error: 'Unable to connect to Portainer',
        details: errorDetails(err),
      });
    }

    const normalized = endpoints.map(normalizeEndpoint);
    // /resources returns per-stack resource aggregates (from container labels), not endpoint stackCount — no attachStackCounts needed.
    // Only fetch Docker containers — K8s pods are served by /api/kubernetes/ routes.
    const upDockerEndpoints = normalized.filter((e) => e.status === 'up' && isDockerEndpoint(e.type));

    // Live `/docker/info` enrichment (#1249+) mutates only counts/snapshotSource —
    // never the status/type fields the filter above reads — so it runs
    // concurrently with the container fan-out instead of ahead of it (#1500).
    const [, fleet] = await Promise.all([
      enrichEndpointsWithLiveDockerInfo(normalized),
      buildFleetResources(upDockerEndpoints, topN),
    ]);

    return {
      fleetCpuPercent: fleet.fleetCpuPercent,
      fleetMemoryPercent: fleet.fleetMemoryPercent,
      topStacks: fleet.topStacks,
      ...(fleet.errors.length > 0 ? { partial: true, failedEndpoints: fleet.errors } : {}),
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
      response: { 200: DashboardFullResponseSchema, 502: ErrorWithDetailsSchema },
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
        log.error({ err }, 'Failed to fetch endpoints from Portainer');
        return reply.code(502).send({
          error: 'Unable to connect to Portainer',
          details: errorDetails(err),
        });
      }
    });
    // If reply was already sent (502), endpointTiming.result is the reply
    if (reply.sent) return;
    rawEndpoints = endpointTiming.result;

    const normalized = rawEndpoints.map(normalizeEndpoint);
    // Live `/docker/info` is the primary source for per-endpoint counts (#1249+).
    // Enrichment mutates only counts/totalCpu/totalMemory/snapshotSource — never
    // the status/type fields the up/Docker filter reads — so it runs concurrently
    // with the stacks fetch and the container fan-out instead of ahead of them (#1500).
    const enrichTimingPromise = timed('edge-live', () => enrichEndpointsWithLiveDockerInfo(normalized));
    // Stack counts from the live stacks list (best-effort, defaults to 0).
    const stacksPromise = fetchStacksSafe();
    // Only fetch Docker containers — K8s pods are served by /api/kubernetes/ routes.
    const upDockerEndpoints = normalized.filter((e) => e.status === 'up' && isDockerEndpoint(e.type));

    // Fetch all containers + build resources (timed as a single block)
    const resourcesTiming = await timed('resources', async () => {
      const [, stackList, fleet] = await Promise.all([
        enrichTimingPromise,
        stacksPromise,
        buildFleetResources(upDockerEndpoints, topN),
      ]);
      attachStackCounts(normalized, stackList);

      // --- Build summary ---
      // Counts come from live-enriched endpoints; healthy/unhealthy derive from
      // the container health statuses we just fetched; stacks from the stacks list.
      const totals = computeFleetTotals(
        normalized,
        fleet.containers.map((c) => c.container),
        stackList.length,
      );

      // Security audit has been in flight since the top of the handler.
      const auditEntries = await securityAuditPromise;
      const security = auditEntries
        ? buildSecurityAuditSummary(auditEntries)
        : { totalAudited: 0, flagged: 0, ignored: 0 };

      return {
        totals,
        security,
        fleetCpuPercent: fleet.fleetCpuPercent,
        fleetMemoryPercent: fleet.fleetMemoryPercent,
        stacks: fleet.topStacks,
        errors: fleet.errors,
      };
    });

    const { totals, security, fleetCpuPercent, fleetMemoryPercent, stacks, errors } = resourcesTiming.result;

    // Resolve KPI history (already in flight)
    const kpiResult = kpiHistoryPromise ? await kpiHistoryPromise : null;
    // Already resolved inside the resources block — awaited again only for its duration.
    const edgeLiveTiming = await enrichTimingPromise;

    // Build Server-Timing header
    const totalDur = Math.round((performance.now() - routeStart) * 100) / 100;
    const timingParts = [
      `endpoints;dur=${endpointTiming.dur}`,
      `edge-live;dur=${edgeLiveTiming.dur}`,
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
