import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { InsightsQuerySchema, InsightIdParamsSchema, SuccessResponseSchema } from '../models/api-schemas.js';

export async function monitoringRoutes(fastify: FastifyInstance) {
  fastify.get('/api/monitoring/insights', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get monitoring insights',
      security: [{ bearerAuth: [] }],
      querystring: InsightsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { severity, acknowledged, limit = 50, offset = 0 } = request.query as {
      severity?: string;
      acknowledged?: boolean;
      limit?: number;
      offset?: number;
    };

    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (severity) {
      conditions.push('severity = ?');
      params.push(severity);
    }
    if (acknowledged !== undefined) {
      conditions.push('is_acknowledged = ?');
      params.push(acknowledged ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const insights = db.prepare(`
      SELECT * FROM insights ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM insights ${where}
    `).get(...params) as { count: number };

    return {
      insights,
      total: total.count,
      limit,
      offset,
    };
  });

  fastify.post('/api/monitoring/insights/:id/acknowledge', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Acknowledge an insight',
      security: [{ bearerAuth: [] }],
      params: InsightIdParamsSchema,
      response: { 200: SuccessResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    db.prepare('UPDATE insights SET is_acknowledged = 1 WHERE id = ?').run(id);
    return { success: true };
  });
}
