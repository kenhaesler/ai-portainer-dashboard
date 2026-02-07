import { FastifyInstance } from 'fastify';
import { getMetricsDb } from '../db/timescale.js';
import { ContainerParamsSchema, MetricsQuerySchema, MetricsResponseSchema, AnomaliesQuerySchema } from '../models/api-schemas.js';
import { getNetworkRates } from '../services/metrics-store.js';
import { selectRollupTable } from '../services/metrics-rollup-selector.js';
import { decimateLTTB } from '../services/lttb-decimator.js';
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

    const db = await getMetricsDb();

    // Parse timeRange or use explicit from/to
    let fromDate: Date;
    let toDate: Date;
    if (query.from) {
      fromDate = new Date(query.from);
      toDate = query.to ? new Date(query.to) : new Date();
    } else {
      const parsed = parseTimeRange(timeRange);
      fromDate = parsed.from;
      toDate = parsed.to;
    }

    // Auto-select rollup table
    const rollup = selectRollupTable(fromDate, toDate);

    const conditions = [`endpoint_id = $1`, `(container_id = $2 OR container_id LIKE $3)`];
    const params: unknown[] = [endpointId, containerId, `${containerId}%`];
    let paramIdx = 4;

    if (metricType) {
      conditions.push(`metric_type = $${paramIdx}`);
      params.push(metricType);
      paramIdx++;
    }

    conditions.push(`${rollup.timestampCol} >= $${paramIdx}`);
    params.push(fromDate.toISOString());
    paramIdx++;

    conditions.push(`${rollup.timestampCol} <= $${paramIdx}`);
    params.push(toDate.toISOString());

    const where = conditions.join(' AND ');
    const { rows: metrics } = await db.query(
      `SELECT ${rollup.timestampCol} as timestamp, ${rollup.valueCol} as value
       FROM ${rollup.table} WHERE ${where}
       ORDER BY ${rollup.timestampCol} ASC
       LIMIT 5000`,
      params,
    );

    // Apply LTTB decimation for raw data
    const decimated = !rollup.isRollup
      ? decimateLTTB(metrics as Array<{ timestamp: string; value: number }>, 500)
      : metrics;

    if (decimated.length === 0) {
      log.debug({ endpointId, containerId, metricType, timeRange }, 'Metrics query returned zero rows');
    }

    // Return in format expected by frontend
    return {
      containerId,
      endpointId,
      metricType: metricType || 'cpu',
      timeRange,
      data: decimated,
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
    const db = await getMetricsDb();

    const { rows: recentMetrics } = await db.query(
      `SELECT m1.*,
        (SELECT AVG(value) FROM metrics m2
         WHERE m2.container_id = m1.container_id
         AND m2.metric_type = m1.metric_type
         AND m2.timestamp > m1.timestamp - INTERVAL '1 hour'
        ) as avg_value
      FROM metrics m1
      WHERE m1.timestamp > NOW() - INTERVAL '24 hours'
      ORDER BY m1.timestamp DESC
      LIMIT $1`,
      [limit],
    );

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
    const rates = await getNetworkRates(Number(endpointId));
    return { rates };
  });
}
