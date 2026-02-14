import { FastifyInstance } from 'fastify';
import {
  getStatusPageConfig,
  getOverallUptime,
  getEndpointUptime,
  getLatestSnapshot,
  getDailyUptimeBuckets,
  getRecentIncidentsPublic,
} from '../services/status-page-store.js';

export async function statusPageRoutes(fastify: FastifyInstance) {
  // Public status page data — no authentication required
  fastify.get('/api/status', {
    schema: {
      tags: ['Status Page'],
      summary: 'Public status page data (unauthenticated)',
    },
  }, async (_request, reply) => {
    const config = await getStatusPageConfig();

    if (!config.enabled) {
      return reply.status(404).send({ error: 'Status page is not enabled' });
    }

    const snapshot = await getLatestSnapshot();
    const hasStoppedOrUnhealthy =
      snapshot && (snapshot.containersStopped > 0 || snapshot.containersUnhealthy > 0);
    const hasDown = snapshot && snapshot.endpointsDown > 0;

    let overallStatus: 'operational' | 'degraded' | 'major_outage' = 'operational';
    if (hasDown) {
      overallStatus = 'major_outage';
    } else if (hasStoppedOrUnhealthy) {
      overallStatus = 'degraded';
    }

    const response: Record<string, unknown> = {
      title: config.title,
      description: config.description,
      overallStatus,
      uptime: {
        '24h': await getOverallUptime(24),
        '7d': await getOverallUptime(168),
        '30d': await getOverallUptime(720),
      },
      endpointUptime: {
        '24h': await getEndpointUptime(24),
        '7d': await getEndpointUptime(168),
        '30d': await getEndpointUptime(720),
      },
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
      uptimeTimeline: await getDailyUptimeBuckets(90),
      autoRefreshSeconds: config.autoRefreshSeconds,
    };

    if (config.showIncidents) {
      response.recentIncidents = await getRecentIncidentsPublic(10);
    }

    return response;
  });
}
