import { FastifyInstance } from 'fastify';
import { getDbForDomain } from '../../../core/db/app-db-router.js';
import { writeAuditLog } from '../../../core/services/audit-logger.js';
import { broadcastActionUpdate } from '../sockets/remediation.js';
import { RemediationQuerySchema, ActionIdParamsSchema, RejectBodySchema } from '../../../core/models/api-schemas.js';
import { restartContainer, startContainer, stopContainer } from '../../../core/portainer/portainer-client.js';

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

    const db = getDbForDomain('actions');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const actions = await db.query<any>(`
      SELECT * FROM actions ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const total = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::integer as count FROM actions ${where}`,
      [...params]
    );

    const pending = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*)::integer as count FROM actions WHERE status = 'pending'"
    );

    return { actions, total: total?.count ?? 0, pendingCount: pending?.count ?? 0, limit, offset };
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
    const db = getDbForDomain('actions');

    const action = await db.queryOne<any>('SELECT * FROM actions WHERE id = ?', [id]);
    if (!action) return reply.code(404).send({ error: 'Action not found' });
    if (action.status !== 'pending') {
      return reply.code(409).send({
        error: `Action is already ${action.status}. Refresh to see latest status.`,
        actionId: id,
        currentStatus: action.status,
      });
    }

    await db.execute(`
      UPDATE actions SET status = 'approved', approved_by = ?, approved_at = NOW()
      WHERE id = ?
    `, [request.user?.username, id]);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'remediation.approve',
      target_type: 'action',
      target_id: id,
      request_id: request.requestId,
      ip_address: request.ip,
    });

    const updated = await db.queryOne<Record<string, unknown>>('SELECT * FROM actions WHERE id = ?', [id]);
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
    const db = getDbForDomain('actions');

    const action = await db.queryOne<any>('SELECT * FROM actions WHERE id = ?', [id]);
    if (!action) return reply.code(404).send({ error: 'Action not found' });
    if (action.status !== 'pending') {
      return reply.code(409).send({
        error: `Action is already ${action.status}. Refresh to see latest status.`,
        actionId: id,
        currentStatus: action.status,
      });
    }

    await db.execute(`
      UPDATE actions SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
      WHERE id = ?
    `, [request.user?.username, reason || null, id]);

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

    const updated = await db.queryOne<Record<string, unknown>>('SELECT * FROM actions WHERE id = ?', [id]);
    if (updated) {
      broadcastActionUpdate(updated);
    }

    return { success: true, actionId: id, status: 'rejected' };
  });

  // Execute an approved action
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
    const db = getDbForDomain('actions');

    const action = await db.queryOne<{
      id: string;
      status: string;
      action_type: string;
      endpoint_id: number;
      container_id: string;
    }>('SELECT * FROM actions WHERE id = ?', [id]);

    if (!action) return reply.code(404).send({ error: 'Action not found' });
    if (action.status !== 'approved') {
      return reply.code(409).send({
        error: `Action must be approved before execution. Current status: ${action.status}.`,
        actionId: id,
        currentStatus: action.status,
      });
    }

    await db.execute(`
      UPDATE actions SET status = 'executing', executed_at = NOW()
      WHERE id = ?
    `, [id]);

    const executing = await db.queryOne<Record<string, unknown>>('SELECT * FROM actions WHERE id = ?', [id]);
    if (executing) {
      broadcastActionUpdate(executing);
    }

    const startedAt = Date.now();
    try {
      if (action.action_type === 'RESTART_CONTAINER') {
        await restartContainer(action.endpoint_id, action.container_id);
      } else if (action.action_type === 'STOP_CONTAINER') {
        await stopContainer(action.endpoint_id, action.container_id);
      } else if (action.action_type === 'START_CONTAINER') {
        await startContainer(action.endpoint_id, action.container_id);
      } else {
        throw new Error(`Unsupported action type: ${action.action_type}`);
      }

      const duration = Date.now() - startedAt;
      await db.execute(`
        UPDATE actions
        SET status = 'completed',
            completed_at = NOW(),
            execution_result = ?,
            execution_duration_ms = ?
        WHERE id = ?
      `, [`Executed ${action.action_type} successfully`, duration, id]);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'remediation.execute',
        target_type: 'action',
        target_id: id,
        details: {
          actionType: action.action_type,
          endpointId: action.endpoint_id,
          containerId: action.container_id,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      const completed = await db.queryOne<Record<string, unknown>>('SELECT * FROM actions WHERE id = ?', [id]);
      if (completed) {
        broadcastActionUpdate(completed);
      }

      return { success: true, actionId: id, status: 'completed' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown execution failure';
      const duration = Date.now() - startedAt;
      await db.execute(`
        UPDATE actions
        SET status = 'failed',
            completed_at = NOW(),
            execution_result = ?,
            execution_duration_ms = ?
        WHERE id = ?
      `, [message, duration, id]);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'remediation.execute.failed',
        target_type: 'action',
        target_id: id,
        details: {
          actionType: action.action_type,
          endpointId: action.endpoint_id,
          containerId: action.container_id,
          error: message,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      const failed = await db.queryOne<Record<string, unknown>>('SELECT * FROM actions WHERE id = ?', [id]);
      if (failed) {
        broadcastActionUpdate(failed);
      }

      return reply.code(502).send({
        error: 'Failed to execute remediation action',
        details: message,
      });
    }
  });
}
