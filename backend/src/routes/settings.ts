import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { writeAuditLog } from '../services/audit-logger.js';
import {
  SettingsQuerySchema,
  SettingKeyParamsSchema,
  SettingUpdateBodySchema,
  AuditLogQuerySchema,
  PreferencesUpdateBodySchema,
} from '../models/api-schemas.js';
import { getUserDefaultLandingPage, setUserDefaultLandingPage } from '../services/user-store.js';

const SENSITIVE_KEYS = new Set([
  'notifications.smtp_password',
  'notifications.teams_webhook_url',
  'oidc.client_secret',
  'elasticsearch.api_key',
  'llm.custom_endpoint_token',
]);

const REDACTED = '••••••••';
const LANDING_PAGE_OPTIONS = new Set([
  '/',
  '/workloads',
  '/fleet',
  '/ai-monitor',
  '/metrics',
  '/remediation',
  '/assistant',
]);

function redactSensitive(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    if (
      typeof row.key === 'string'
      && isSensitiveSettingKey(row.key)
      && row.value
    ) {
      return { ...row, value: REDACTED };
    }
    return row;
  });
}

function isSensitiveSettingKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;

  const keyLower = key.toLowerCase();
  return (
    keyLower.endsWith('_password')
    || keyLower.endsWith('_secret')
    || keyLower.endsWith('_token')
    || keyLower.endsWith('_api_key')
    || keyLower.endsWith('.password')
    || keyLower.endsWith('.secret')
    || keyLower.endsWith('.token')
    || keyLower.endsWith('.api_key')
    || keyLower.endsWith('.webhook_url')
  );
}

export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/settings/preferences', {
    schema: {
      tags: ['Settings'],
      summary: 'Get current user preferences',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const userId = request.user?.sub;
    return {
      defaultLandingPage: userId ? getUserDefaultLandingPage(userId) : '/',
    };
  });

  fastify.patch('/api/settings/preferences', {
    schema: {
      tags: ['Settings'],
      summary: 'Update current user preferences',
      security: [{ bearerAuth: [] }],
      body: PreferencesUpdateBodySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { defaultLandingPage } = request.body as { defaultLandingPage: string };
    if (!LANDING_PAGE_OPTIONS.has(defaultLandingPage)) {
      return reply.code(400).send({ error: 'Invalid landing page route' });
    }

    setUserDefaultLandingPage(userId, defaultLandingPage);
    return { defaultLandingPage };
  });

  // Get all settings
  fastify.get('/api/settings', {
    schema: {
      tags: ['Settings'],
      summary: 'Get all settings',
      security: [{ bearerAuth: [] }],
      querystring: SettingsQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
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

    const responseValue = isSensitiveSettingKey(key) ? REDACTED : value;
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
    const { action, userId, limit = 100, offset = 0, cursor } = request.query as {
      action?: string;
      userId?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    };

    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (userId) { conditions.push('user_id = ?'); params.push(userId); }

    // Cursor-based pagination: cursor is "created_at|id"
    if (cursor) {
      const [cursorDate, cursorId] = cursor.split('|');
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(cursorDate, cursorDate, Number(cursorId));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch N+1 to determine hasMore
    const fetchLimit = limit + 1;
    const entries = cursor
      ? db.prepare(`
          SELECT * FROM audit_log ${where}
          ORDER BY created_at DESC, id DESC LIMIT ?
        `).all(...params, fetchLimit) as Array<Record<string, unknown>>
      : db.prepare(`
          SELECT * FROM audit_log ${where}
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
        `).all(...params, fetchLimit, offset) as Array<Record<string, unknown>>;

    const hasMore = entries.length > limit;
    const items = hasMore ? entries.slice(0, limit) : entries;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? `${lastItem.created_at}|${lastItem.id}`
      : null;

    return { entries: items, limit, offset, nextCursor, hasMore };
  });
}
