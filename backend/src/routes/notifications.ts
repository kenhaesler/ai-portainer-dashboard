import { FastifyInstance } from 'fastify';
import { getDbForDomain } from '../db/app-db-router.js';
import { sendTestNotification } from '../services/notification-service.js';
import { NotificationHistoryQuerySchema, NotificationTestBodySchema } from '../models/api-schemas.js';

export async function notificationRoutes(fastify: FastifyInstance) {
  // Get notification history
  fastify.get('/api/notifications/history', {
    schema: {
      tags: ['Notifications'],
      summary: 'Get notification history',
      security: [{ bearerAuth: [] }],
      querystring: NotificationHistoryQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { channel, limit = 50, offset = 0 } = request.query as {
      channel?: string;
      limit?: number;
      offset?: number;
    };

    const db = getDbForDomain('notifications');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (channel) {
      conditions.push('channel = ?');
      params.push(channel);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const entries = await db.query(`
      SELECT * FROM notification_log ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const total = await db.queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM notification_log ${where}
    `, [...params]);

    return {
      entries,
      total: total?.count ?? 0,
      limit,
      offset,
    };
  });

  // Send a test notification
  fastify.post('/api/notifications/test', {
    schema: {
      tags: ['Notifications'],
      summary: 'Send a test notification',
      security: [{ bearerAuth: [] }],
      body: NotificationTestBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { channel } = request.body as { channel: 'teams' | 'email' | 'discord' | 'telegram' };
    const result = await sendTestNotification(channel);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true };
  });
}
