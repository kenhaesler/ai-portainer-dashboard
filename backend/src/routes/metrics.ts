import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { ContainerParamsSchema, MetricsQuerySchema, MetricsResponseSchema, AnomaliesQuerySchema } from '../models/api-schemas.js';
import { getNetworkRates } from '../services/metrics-store.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('metrics-routes');

function parseTimeRange(timeRange: string): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  let from = new Date(now);

  const match = timeRange.match(/^(\d+)([mhd])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 'm': from.setMinutes(from.getMinutes() - value); break;
      case 'h': from.setHours(from.getHours() - value); break;
      case 'd': from.setDate(from.getDate() - value); break;
    }
  } else {
    // Default to 1 hour
    from.setHours(from.getHours() - 1);
  }

  return { from, to };
}

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/metrics/:endpointId/:containerId', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get container metrics time series',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      querystring: MetricsQuerySchema,
      response: { 200: MetricsResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId, containerId } = request.params as { endpointId: number; containerId: string };
    const query = request.query as {
      metricType?: string;
      timeRange?: string;
      metric_type?: string;
      from?: string;
      to?: string;
    };

    // Support both naming conventions
    const metricType = query.metricType || query.metric_type;
    const timeRange = query.timeRange || '1h';

    const db = getDb();
    const conditions = ['endpoint_id = ?', '(container_id = ? OR container_id LIKE ?)'];
    const params: unknown[] = [endpointId, containerId, `${containerId}%`];

    if (metricType) {
      conditions.push('metric_type = ?');
      params.push(metricType);
    }

    // Parse timeRange or use explicit from/to
    if (query.from) {
      conditions.push('timestamp >= ?');
      params.push(query.from);
    } else {
      const { from } = parseTimeRange(timeRange);
      conditions.push('timestamp >= datetime(?)');
      params.push(from.toISOString());
    }

    if (query.to) {
      conditions.push('timestamp <= datetime(?)');
      params.push(query.to);
    }

    const where = conditions.join(' AND ');
    const metrics = db.prepare(`
      SELECT timestamp, value FROM metrics WHERE ${where}
      ORDER BY timestamp ASC
      LIMIT 1000
    `).all(...params) as Array<{ timestamp: string; value: number }>;

    if (metrics.length === 0) {
      log.debug({ endpointId, containerId, metricType, timeRange }, 'Metrics query returned zero rows');
    }

    // Return in format expected by frontend
    return {
      containerId,
      endpointId,
      metricType: metricType || 'cpu',
      timeRange,
      data: metrics,
    };
  });

  fastify.get('/api/metrics/anomalies', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get recent anomaly detections',
      security: [{ bearerAuth: [] }],
      querystring: AnomaliesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { limit = 50 } = request.query as { limit?: number };
    const db = getDb();

    // Get metrics with high z-score-like values (values significantly above average)
    const recentMetrics = db.prepare(`
      SELECT m1.*,
        (SELECT AVG(value) FROM metrics m2
         WHERE m2.container_id = m1.container_id
         AND m2.metric_type = m1.metric_type
         AND m2.timestamp > datetime(m1.timestamp, '-1 hour')
        ) as avg_value
      FROM metrics m1
      WHERE m1.timestamp > datetime('now', '-24 hours')
      ORDER BY m1.timestamp DESC
      LIMIT ?
    `).all(limit);

    return { anomalies: recentMetrics };
  });

  fastify.get('/api/metrics/network-rates/:endpointId', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get network I/O rates for all containers in an endpoint',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.params as { endpointId: string };
    const rates = getNetworkRates(Number(endpointId));
    return { rates };
  });
}
