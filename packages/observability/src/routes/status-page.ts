import { FastifyInstance } from 'fastify';
import '@fastify/swagger';
import {
  getStatusPageConfig,
  getUptimeSummary,
  getLatestSnapshot,
  getDailyUptimeBuckets,
  getRecentIncidentsPublic,
} from '../services/status-page-store.js';

/**
 * TTL for the in-memory status payload cache.
 *
 * GET /api/status is unauthenticated AND exempt from the global rate limit
 * (see OBSERVER_READ_PATH_PREFIXES in packages/core/src/plugins/rate-limit.ts),
 * so the assembled payload is cached for a short window — an anonymous
 * scraper hitting the route in a tight loop triggers at most one DB fan-out
 * per TTL window. The underlying monitoring_snapshots data only changes once
 * per monitoring cycle (minutes), so 15s of staleness is invisible next to
 * the page's own 30s default auto-refresh.
 *
 * Invalidation is TTL-only: the settings save path lives in another package
 * (@dashboard/foundation) with no hook into this module, so admin changes to
 * status.page.* settings take effect within this window rather than
 * instantly (#1506).
 */
export const STATUS_PAGE_CACHE_TTL_MS = 15_000;

// payload === null means the status page is disabled (served as 404).
// The in-flight promise is cached (not just the resolved value) so
// concurrent cold-cache requests share a single DB fan-out.
interface CachedStatus {
  payload: Record<string, unknown> | null;
}

let statusCache: { expiresAt: number; load: Promise<CachedStatus> } | null = null;

/** Resets the module-level payload cache (test hook). */
export function clearStatusPageCache(): void {
  statusCache = null;
}

async function loadStatusPayload(): Promise<CachedStatus> {
  const config = await getStatusPageConfig();

  // Disabled: only the single batched config lookup runs — no snapshot,
  // uptime, timeline or incident queries.
  if (!config.enabled) {
    return { payload: null };
  }

  const [snapshot, uptime, uptimeTimeline, recentIncidents] = await Promise.all([
    getLatestSnapshot(),
    getUptimeSummary(),
    getDailyUptimeBuckets(90),
    config.showIncidents ? getRecentIncidentsPublic(10) : Promise.resolve(null),
  ]);

  const hasStoppedOrUnhealthy =
    snapshot && (snapshot.containersStopped > 0 || snapshot.containersUnhealthy > 0);
  const hasDown = snapshot && snapshot.endpointsDown > 0;

  let overallStatus: 'operational' | 'degraded' | 'major_outage' = 'operational';
  if (hasDown) {
    overallStatus = 'major_outage';
  } else if (hasStoppedOrUnhealthy) {
    overallStatus = 'degraded';
  }

  const payload: Record<string, unknown> = {
    title: config.title,
    description: config.description,
    overallStatus,
    uptime: uptime.containers,
    endpointUptime: uptime.endpoints,
    snapshot: snapshot
      ? {
          containersRunning: snapshot.containersRunning,
          containersStopped: snapshot.containersStopped,
          containersUnhealthy: snapshot.containersUnhealthy,
          endpointsUp: snapshot.endpointsUp,
          endpointsDown: snapshot.endpointsDown,
          lastChecked: snapshot.createdAt,
        }
      : null,
    uptimeTimeline,
    autoRefreshSeconds: config.autoRefreshSeconds,
  };

  if (recentIncidents) {
    payload.recentIncidents = recentIncidents;
  }

  return { payload };
}

export async function statusPageRoutes(fastify: FastifyInstance) {
  // Public status page data — no authentication required
  fastify.get('/api/status', {
    schema: {
      tags: ['Status Page'],
      summary: 'Public status page data (unauthenticated)',
    },
  }, async (_request, reply) => {
    const now = Date.now();
    let entry = statusCache;

    if (!entry || entry.expiresAt <= now) {
      const load = loadStatusPayload();
      entry = { expiresAt: now + STATUS_PAGE_CACHE_TTL_MS, load };
      statusCache = entry;
      // A failed load must not poison the cache for a full TTL window.
      load.catch(() => {
        if (statusCache === entry) statusCache = null;
      });
    }

    const { payload } = await entry.load;

    if (!payload) {
      return reply.status(404).send({ error: 'Status page is not enabled' });
    }

    return payload;
  });
}
