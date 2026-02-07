import { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { InsightsQuerySchema, InsightIdParamsSchema, SuccessResponseSchema } from '../models/api-schemas.js';
import {
  getSecurityAudit,
  getSecurityAuditIgnoreList,
  setSecurityAuditIgnoreList,
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
  SECURITY_AUDIT_IGNORE_KEY,
} from '../services/security-audit.js';

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
    const { severity, acknowledged, limit = 50, offset = 0, cursor } = request.query as {
      severity?: string;
      acknowledged?: boolean;
      limit?: number;
      offset?: number;
      cursor?: string;
    };

    const db = getDb();
    const filterConditions: string[] = [];
    const filterParams: unknown[] = [];

    if (severity) {
      filterConditions.push('severity = ?');
      filterParams.push(severity);
    }
    if (acknowledged !== undefined) {
      filterConditions.push('is_acknowledged = ?');
      filterParams.push(acknowledged ? 1 : 0);
    }

    const filterWhere = filterConditions.length > 0
      ? `WHERE ${filterConditions.join(' AND ')}`
      : '';

    // Build full conditions including cursor
    const conditions = [...filterConditions];
    const params = [...filterParams];

    if (cursor) {
      const [cursorDate, cursorId] = cursor.split('|');
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(cursorDate, cursorDate, cursorId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch N+1 to determine hasMore
    const fetchLimit = limit + 1;
    const insights = cursor
      ? db.prepare(`
          SELECT * FROM insights ${where}
          ORDER BY created_at DESC, id DESC LIMIT ?
        `).all(...params, fetchLimit) as Array<Record<string, unknown>>
      : db.prepare(`
          SELECT * FROM insights ${where}
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
        `).all(...params, fetchLimit, offset) as Array<Record<string, unknown>>;

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM insights ${filterWhere}
    `).get(...filterParams) as { count: number };

    const hasMore = insights.length > limit;
    const items = hasMore ? insights.slice(0, limit) : insights;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? `${lastItem.created_at}|${lastItem.id}`
      : null;

    return {
      insights: items,
      total: total.count,
      limit,
      offset,
      nextCursor,
      hasMore,
    };
  });

  fastify.get('/api/monitoring/insights/container/:containerId', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get anomaly explanations for a specific container',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { containerId } = request.params as { containerId: string };
    const { timeRange = '1h', metricType } = request.query as {
      timeRange?: string;
      metricType?: string;
    };

    const db = getDb();

    // Parse timeRange into an SQLite-compatible interval
    let interval = '-1 hours';
    const match = timeRange.match(/^(\d+)([mhd])$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      switch (unit) {
        case 'm': interval = `-${value} minutes`; break;
        case 'h': interval = `-${value} hours`; break;
        case 'd': interval = `-${value} days`; break;
      }
    }

    const conditions = [
      '(container_id = ? OR container_id LIKE ?)',
      "category IN ('anomaly', 'predictive')",
      "created_at >= datetime('now', ?)",
    ];
    const params: unknown[] = [containerId, `${containerId}%`, interval];

    if (metricType) {
      conditions.push('title LIKE ?');
      params.push(`%${metricType}%`);
    }

    const where = conditions.join(' AND ');
    const rows = db.prepare(`
      SELECT id, severity, category, title, description, suggested_action, created_at
      FROM insights
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT 50
    `).all(...params) as Array<{
      id: string;
      severity: string;
      category: string;
      title: string;
      description: string;
      suggested_action: string | null;
      created_at: string;
    }>;

    // Parse out AI Analysis from description field
    const explanations = rows.map((row) => {
      const aiSplit = row.description.split('\n\nAI Analysis: ');
      return {
        id: row.id,
        severity: row.severity,
        category: row.category,
        title: row.title,
        description: aiSplit[0],
        aiExplanation: aiSplit.length > 1 ? aiSplit[1] : null,
        suggestedAction: row.suggested_action,
        timestamp: row.created_at,
      };
    });

    return { explanations };
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

  fastify.get('/api/security/audit', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get capability security audit for all endpoints',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const entries = await getSecurityAudit();
    return { entries };
  });

  fastify.get('/api/security/audit/:endpointId', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get capability security audit for one endpoint',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.params as { endpointId: string };
    const parsedEndpointId = Number(endpointId);
    const entries = await getSecurityAudit(parsedEndpointId);
    return { entries };
  });

  fastify.get('/api/security/ignore-list', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get security audit ignore list',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return {
      key: SECURITY_AUDIT_IGNORE_KEY,
      category: 'security',
      defaults: DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
      patterns: getSecurityAuditIgnoreList(),
    };
  });

  fastify.put('/api/security/ignore-list', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Update security audit ignore list',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const body = request.body as { patterns?: unknown };
    const patterns = Array.isArray(body?.patterns)
      ? body.patterns.filter((value): value is string => typeof value === 'string')
      : [];

    const saved = setSecurityAuditIgnoreList(patterns);
    return {
      success: true,
      key: SECURITY_AUDIT_IGNORE_KEY,
      category: 'security',
      patterns: saved,
    };
  });
}
