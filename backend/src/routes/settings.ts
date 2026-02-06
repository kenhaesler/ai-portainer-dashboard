import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { SettingsQuerySchema, SettingKeyParamsSchema, SettingUpdateBodySchema, AuditLogQuerySchema } from '../models/api-schemas.js';

const SENSITIVE_KEYS = new Set([
  'notifications.smtp_password',
  'notifications.teams_webhook_url',
]);

const REDACTED = '••••••••';

function redactSensitive(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    if (typeof row.key === 'string' && SENSITIVE_KEYS.has(row.key) && row.value) {
      return { ...row, value: REDACTED };
    }
    return row;
  });
}

export async function settingsRoutes(fastify: FastifyInstance) {
  // Get all settings
  fastify.get('/api/settings', {
    schema: {
      tags: ['Settings'],
      summary: 'Get all settings',
      security: [{ bearerAuth: [] }],
      querystring: SettingsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { category } = request.query as { category?: string };
    const db = getDb();

    const rows = category
      ? db.prepare('SELECT * FROM settings WHERE category = ?').all(category) as Array<Record<string, unknown>>
      : db.prepare('SELECT * FROM settings').all() as Array<Record<string, unknown>>;
    return redactSensitive(rows);
  });

  // Set a setting
  fastify.put('/api/settings/:key', {
    schema: {
      tags: ['Settings'],
      summary: 'Create or update a setting',
      security: [{ bearerAuth: [] }],
      params: SettingKeyParamsSchema,
      body: SettingUpdateBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { key } = request.params as { key: string };
    const { value, category = 'general' } = request.body as { value: string; category?: string };
    const db = getDb();

    db.prepare(`
      INSERT INTO settings (key, value, category, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, category = ?, updated_at = datetime('now')
    `).run(key, value, category, value, category);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'settings.update',
      target_type: 'setting',
      target_id: key,
      details: { category },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    const responseValue = SENSITIVE_KEYS.has(key) ? REDACTED : value;
    return { success: true, key, value: responseValue };
  });

  // Delete a setting
  fastify.delete('/api/settings/:key', {
    schema: {
      tags: ['Settings'],
      summary: 'Delete a setting',
      security: [{ bearerAuth: [] }],
      params: SettingKeyParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { key } = request.params as { key: string };
    const db = getDb();
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return { success: true };
  });

  // Audit log
  fastify.get('/api/settings/audit-log', {
    schema: {
      tags: ['Settings'],
      summary: 'Get audit log entries',
      security: [{ bearerAuth: [] }],
      querystring: AuditLogQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { action, userId, limit = 100, offset = 0 } = request.query as {
      action?: string;
      userId?: string;
      limit?: number;
      offset?: number;
    };

    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (userId) { conditions.push('user_id = ?'); params.push(userId); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const entries = db.prepare(`
      SELECT * FROM audit_log ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { entries, limit, offset };
  });
}
