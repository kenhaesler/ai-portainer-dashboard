import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { broadcastActionUpdate } from '../sockets/remediation.js';
import { RemediationQuerySchema, ActionIdParamsSchema, RejectBodySchema } from '../models/api-schemas.js';

export async function remediationRoutes(fastify: FastifyInstance) {
  // List actions
  fastify.get('/api/remediation/actions', {
    schema: {
      tags: ['Remediation'],
      summary: 'List remediation actions',
      security: [{ bearerAuth: [] }],
      querystring: RemediationQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { status, limit = 50, offset = 0 } = request.query as {
      status?: string;
      limit?: number;
      offset?: number;
    };

    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const actions = db.prepare(`
      SELECT * FROM actions ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(
      `SELECT COUNT(*) as count FROM actions ${where}`
    ).get(...params) as { count: number };

    const pending = db.prepare(
      "SELECT COUNT(*) as count FROM actions WHERE status = 'pending'"
    ).get() as { count: number };

    return { actions, total: total.count, pendingCount: pending.count, limit, offset };
  });

  // Approve action
  fastify.post('/api/remediation/actions/:id/approve', {
    schema: {
      tags: ['Remediation'],
      summary: 'Approve a pending action',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as any;
    if (!action) return reply.code(404).send({ error: 'Action not found' });
    if (action.status !== 'pending') {
      return reply.code(409).send({
        error: `Action is already ${action.status}. Refresh to see latest status.`,
        actionId: id,
        currentStatus: action.status,
      });
    }

    db.prepare(`
      UPDATE actions SET status = 'approved', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(request.user?.username, id);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'remediation.approve',
      target_type: 'action',
      target_id: id,
      request_id: request.requestId,
      ip_address: request.ip,
    });

    const updated = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (updated) {
      broadcastActionUpdate(updated);
    }

    return { success: true, actionId: id, status: 'approved' };
  });

  // Reject action
  fastify.post('/api/remediation/actions/:id/reject', {
    schema: {
      tags: ['Remediation'],
      summary: 'Reject a pending action',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
      body: RejectBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = (request.body as { reason?: string }) || {};
    const db = getDb();

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as any;
    if (!action) return reply.code(404).send({ error: 'Action not found' });
    if (action.status !== 'pending') {
      return reply.code(409).send({
        error: `Action is already ${action.status}. Refresh to see latest status.`,
        actionId: id,
        currentStatus: action.status,
      });
    }

    db.prepare(`
      UPDATE actions SET status = 'rejected', rejected_by = ?, rejected_at = datetime('now'), rejection_reason = ?
      WHERE id = ?
    `).run(request.user?.username, reason || null, id);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'remediation.reject',
      target_type: 'action',
      target_id: id,
      details: { reason },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    const updated = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (updated) {
      broadcastActionUpdate(updated);
    }

    return { success: true, actionId: id, status: 'rejected' };
  });
}
