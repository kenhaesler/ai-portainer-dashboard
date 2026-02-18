import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';
import { writeAuditLog } from '../services/audit-logger.js';
import {
  SettingsQuerySchema,
  SettingKeyParamsSchema,
  SettingUpdateBodySchema,
  AuditLogQuerySchema,
  PreferencesUpdateBodySchema,
} from '../models/api-schemas.js';
import { getUserDefaultLandingPage, setUserDefaultLandingPage } from '../services/user-store.js';
import { PROMPT_FEATURES, DEFAULT_PROMPTS, getEffectivePrompt } from '../services/prompt-store.js';
import {
  createPromptVersion,
  getPromptHistory,
  getPromptVersionById,
} from '../services/prompt-version-store.js';

const SENSITIVE_KEYS = new Set([
  'notifications.smtp_password',
  'notifications.teams_webhook_url',
  'notifications.discord_webhook_url',
  'notifications.telegram_bot_token',
  'oidc.client_secret',
  'elasticsearch.api_key',
  'llm.custom_endpoint_token',
  'portainer_backup.password',
  'harbor.robot_secret',
]);
const SECURITY_CRITICAL_URL_KEYS = new Set(['llm.ollama_url', 'oidc.issuer_url', 'harbor.api_url']);

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

function validateSecurityCriticalUrl(key: string, value: string): string | null {
  if (!SECURITY_CRITICAL_URL_KEYS.has(key)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${key} must be a valid URL`;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `${key} must use http:// or https://`;
  }

  if (key === 'oidc.issuer_url' && process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    return 'oidc.issuer_url must use https:// in production';
  }

  return null;
}

const log = createChildLogger('settings-route');

export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/settings/preferences', {
    schema: {
      tags: ['Settings'],
      summary: 'Get current user preferences',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user?.sub;
    return {
      defaultLandingPage: userId ? await getUserDefaultLandingPage(userId) : '/',
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

    await setUserDefaultLandingPage(userId, defaultLandingPage);
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
  }, async (request, reply) => {
    const { category } = request.query as { category?: string };
    const db = getDbForDomain('settings');

    const rows = category
      ? await db.query<Record<string, unknown>>('SELECT * FROM settings WHERE category = ?', [category])
      : await db.query<Record<string, unknown>>('SELECT * FROM settings');
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
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const { value, category } = request.body as { value: string; category?: string };
    const db = getDbForDomain('settings');
    const validationError = validateSecurityCriticalUrl(key, value);

    if (validationError) {
      return reply.code(400).send({ error: validationError });
    }

    const existingSetting = await db
      .queryOne<{ category?: string }>('SELECT category FROM settings WHERE key = ?', [key]);
    const effectiveCategory = category ?? existingSetting?.category ?? 'general';

    await db.execute(`
      INSERT INTO settings (key, value, category, updated_at)
      VALUES (?, ?, ?, NOW())
      ON CONFLICT(key) DO UPDATE SET value = ?, category = ?, updated_at = NOW()
    `, [key, value, effectiveCategory, value, effectiveCategory]);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'settings.update',
      target_type: 'setting',
      target_id: key,
      details: { category: effectiveCategory },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    // Auto-version prompt system_prompt saves
    const promptMatch = key.match(/^prompts\.(.+)\.system_prompt$/);
    if (promptMatch) {
      const feature = promptMatch[1];
      if (PROMPT_FEATURES.some((f) => f.key === feature)) {
        createPromptVersion(feature, value, request.user?.username ?? 'admin').catch((err) => {
          log.warn({ err, feature }, 'Failed to auto-create prompt version on save');
        });
      }
    }

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
    const db = getDbForDomain('settings');
    await db.execute('DELETE FROM settings WHERE key = ?', [key]);
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

    const db = getDbForDomain('audit');
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
      ? await db.query<Record<string, unknown>>(`
          SELECT * FROM audit_log ${where}
          ORDER BY created_at DESC, id DESC LIMIT ?
        `, [...params, fetchLimit])
      : await db.query<Record<string, unknown>>(`
          SELECT * FROM audit_log ${where}
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
        `, [...params, fetchLimit, offset]);

    const hasMore = entries.length > limit;
    const items = hasMore ? entries.slice(0, limit) : entries;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? `${lastItem.created_at}|${lastItem.id}`
      : null;

    return { entries: items, limit, offset, nextCursor, hasMore };
  });

  // Get prompt feature definitions and defaults (for AI Prompts settings tab)
  fastify.get('/api/settings/prompt-features', {
    schema: {
      tags: ['Settings'],
      summary: 'Get prompt feature definitions and default prompts',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    const features = await Promise.all(
      PROMPT_FEATURES.map(async (f) => ({
        ...f,
        defaultPrompt: DEFAULT_PROMPTS[f.key],
        effectivePrompt: await getEffectivePrompt(f.key),
      })),
    );
    return { features };
  });

  // Get version history for a prompt feature
  const PromptFeatureParamsSchema = z.object({ feature: z.string().min(1) });

  fastify.get('/api/settings/prompts/:feature/history', {
    schema: {
      tags: ['Settings'],
      summary: 'Get prompt version history for a feature',
      security: [{ bearerAuth: [] }],
      params: PromptFeatureParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { feature } = request.params as z.infer<typeof PromptFeatureParamsSchema>;
    if (!PROMPT_FEATURES.some((f) => f.key === feature)) {
      return (reply as any).code(404).send({ error: `Unknown feature: ${feature}` });
    }
    const versions = await getPromptHistory(feature);
    return { versions };
  });

  // Rollback a prompt feature to a previous version
  const RollbackBodySchema = z.object({ versionId: z.number().int().positive() });

  fastify.post('/api/settings/prompts/:feature/rollback', {
    schema: {
      tags: ['Settings'],
      summary: 'Rollback a prompt to a previous version',
      security: [{ bearerAuth: [] }],
      params: PromptFeatureParamsSchema,
      body: RollbackBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { feature } = request.params as z.infer<typeof PromptFeatureParamsSchema>;
    const { versionId } = request.body as z.infer<typeof RollbackBodySchema>;

    if (!PROMPT_FEATURES.some((f) => f.key === feature)) {
      return (reply as any).code(404).send({ error: `Unknown feature: ${feature}` });
    }

    const targetVersion = await getPromptVersionById(versionId, feature);
    if (!targetVersion) {
      return (reply as any).code(404).send({ error: 'Version not found' });
    }

    // Write the rolled-back prompt to settings
    const db = getDbForDomain('settings');
    const settingKey = `prompts.${feature}.system_prompt`;
    await db.execute(
      `INSERT INTO settings (key, value, category, updated_at)
       VALUES (?, ?, 'prompts', NOW())
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = NOW()`,
      [settingKey, targetVersion.systemPrompt, targetVersion.systemPrompt],
    );

    // Record the rollback as a new version
    const newVersion = await createPromptVersion(
      feature,
      targetVersion.systemPrompt,
      request.user?.username ?? 'admin',
      { changeNote: `Rolled back to v${targetVersion.version}` },
    );

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'prompts.rollback',
      target_type: 'prompt',
      target_id: feature,
      details: { rolledBackToVersion: targetVersion.version, newVersion: newVersion.version },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, newVersion };
  });
}
