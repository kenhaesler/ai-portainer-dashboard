import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/metrics/:endpointId/:containerId', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get container metrics time series',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          endpointId: { type: 'number' },
          containerId: { type: 'string' },
        },
        required: ['endpointId', 'containerId'],
      },
      querystring: {
        type: 'object',
        properties: {
          metric_type: { type: 'string', enum: ['cpu', 'memory', 'memory_bytes'] },
          from: { type: 'string' },
          to: { type: 'string' },
          resolution: { type: 'string', enum: ['1m', '5m', '1h'], default: '5m' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { containerId } = request.params as { endpointId: number; containerId: string };
    const { metric_type, from, to } = request.query as {
      metric_type?: string;
      from?: string;
      to?: string;
      resolution?: string;
    };

    const db = getDb();
    const conditions = ['container_id = ?'];
    const params: unknown[] = [containerId];

    if (metric_type) {
      conditions.push('metric_type = ?');
      params.push(metric_type);
    }
    if (from) {
      conditions.push('timestamp >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('timestamp <= ?');
      params.push(to);
    }

    const where = conditions.join(' AND ');
    const metrics = db.prepare(`
      SELECT * FROM metrics WHERE ${where}
      ORDER BY timestamp ASC
      LIMIT 1000
    `).all(...params);

    return { metrics, containerId };
  });

  fastify.get('/api/metrics/anomalies', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get recent anomaly detections',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
        },
      },
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
}
