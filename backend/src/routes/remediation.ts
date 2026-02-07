import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { writeAuditLog } from '../services/audit-logger.js';
import * as portainer from '../services/portainer-client.js';
import { createChildLogger } from '../utils/logger.js';
import { broadcastActionUpdate } from '../sockets/remediation.js';
import { RemediationQuerySchema, ActionIdParamsSchema, RejectBodySchema, SuccessResponseSchema, ErrorResponseSchema } from '../models/api-schemas.js';

const log = createChildLogger('remediation-route');

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

  // Execute action
  fastify.post('/api/remediation/actions/:id/execute', {
    schema: {
      tags: ['Remediation'],
      summary: 'Execute an approved action',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as any;
    if (!action) return reply.code(404).send({ error: 'Action not found' });
    if (action.status !== 'approved') {
      return reply.code(409).send({
        error: `Action is already ${action.status}. Refresh to see latest status.`,
        actionId: id,
        currentStatus: action.status,
      });
    }

    // Mark as executing
    db.prepare(`
      UPDATE actions SET status = 'executing', executed_at = datetime('now')
      WHERE id = ?
    `).run(id);
    {
      const executing = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (executing) {
        broadcastActionUpdate(executing);
      }
    }

    const startTime = Date.now();

    try {
      // Execute based on action type
      switch (action.action_type) {
        case 'RESTART_CONTAINER':
          await portainer.restartContainer(action.endpoint_id, action.container_id);
          break;
        case 'STOP_CONTAINER':
          await portainer.stopContainer(action.endpoint_id, action.container_id);
          break;
        case 'START_CONTAINER':
          await portainer.startContainer(action.endpoint_id, action.container_id);
          break;
        default:
          throw new Error(`Unknown action type: ${action.action_type}`);
      }

      const duration = Date.now() - startTime;
      db.prepare(`
        UPDATE actions SET status = 'completed', completed_at = datetime('now'),
        execution_result = 'success', execution_duration_ms = ?
        WHERE id = ?
      `).run(duration, id);
      {
        const completed = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (completed) {
          broadcastActionUpdate(completed);
        }
      }

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'remediation.execute',
        target_type: 'action',
        target_id: id,
        details: { actionType: action.action_type, containerId: action.container_id, duration },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return { success: true, actionId: id, status: 'completed', duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';

      db.prepare(`
        UPDATE actions SET status = 'failed', completed_at = datetime('now'),
        execution_result = ?, execution_duration_ms = ?
        WHERE id = ?
      `).run(errorMsg, duration, id);
      {
        const failed = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (failed) {
          broadcastActionUpdate(failed);
        }
      }

      log.error({ err, actionId: id }, 'Action execution failed');
      return reply.code(500).send({ error: errorMsg, actionId: id, status: 'failed' });
    }
  });
}
