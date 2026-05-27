import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { FastifyInstance } from 'fastify';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { InsightsQuerySchema, InsightIdParamsSchema, SuccessResponseSchema } from '@dashboard/core/models/api-schemas.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import {
  SensitivityPutBodySchema,
  getUserPreset,
  setUserPreset,
  shouldIncludeAnomaly,
  getDefaultThresholds,
} from '../services/sensitivity-preset.js';

const log = createChildLogger('route:monitoring');

export interface MonitoringRoutesOpts {
  /** Get security audit entries, optionally filtered by endpoint ID */
  getSecurityAudit: (endpointId?: number) => Promise<unknown[]>;
  /** Get the current security audit ignore list */
  getSecurityAuditIgnoreList: () => Promise<string[]>;
  /** Update the security audit ignore list */
  setSecurityAuditIgnoreList: (patterns: string[]) => Promise<string[]>;
  /** Default ignore patterns */
  defaultSecurityAuditIgnorePatterns: readonly string[];
  /** Storage key for the ignore list */
  securityAuditIgnoreKey: string;
}

export async function monitoringRoutes(fastify: FastifyInstance, opts: MonitoringRoutesOpts) {
  fastify.get('/api/monitoring/insights', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get monitoring insights',
      security: [{ bearerAuth: [] }],
      querystring: InsightsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { severity, acknowledged, limit = 50, offset = 0, cursor } = request.query as {
      severity?: string;
      acknowledged?: boolean;
      limit?: number;
      offset?: number;
      cursor?: string;
    };

    try {
      const db = getDbForDomain('insights');
      const filterConditions: string[] = [];
      const filterParams: unknown[] = [];

      if (severity) {
        filterConditions.push('severity = ?');
        filterParams.push(severity);
      }
      if (acknowledged !== undefined) {
        filterConditions.push('is_acknowledged = ?');
        filterParams.push(acknowledged);
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
        ? await db.query<Record<string, unknown>>(`
            SELECT * FROM insights ${where}
            ORDER BY created_at DESC, id DESC LIMIT ?
          `, [...params, fetchLimit])
        : await db.query<Record<string, unknown>>(`
            SELECT * FROM insights ${where}
            ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
          `, [...params, fetchLimit, offset]);

      const total = await db.queryOne<{ count: number }>(`
        SELECT COUNT(*)::integer as count FROM insights ${filterWhere}
      `, [...filterParams]);

      const hasMore = insights.length > limit;
      const items = hasMore ? insights.slice(0, limit) : insights;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem
        ? `${lastItem.created_at}|${lastItem.id}`
        : null;

      // Per-user Sensitivity post-filter (issue #1297).
      // Detectors write every anomaly to the shared table; the read path
      // hides records below the user's effective z-score threshold. Items
      // without a parseable z-score (e.g. predictive forecasts) always
      // pass through.
      const userId = request.user?.sub;
      const preset = userId ? await getUserPreset(userId) : 'default';
      const defaults = getDefaultThresholds();
      const filteredItems = items.filter((i) =>
        shouldIncludeAnomaly(
          { description: String(i.description ?? ''), category: i.category as string | null | undefined },
          preset,
          defaults,
        ),
      );

      return {
        insights: filteredItems,
        // `total` keeps its original DB-count semantics so existing
        // pagination clients aren't surprised. `visibleTotal` reflects the
        // count after the per-user Sensitivity preset post-filter on this
        // page — different presets should produce different visible counts
        // on the same data (issue #1297 AC).
        //
        // Finding #5 (PR #1304 review): trade-off — because the Sensitivity
        // post-filter runs AFTER pagination, `filteredItems.length` on a
        // given page can be less than `limit` even when more pages exist.
        // Clients MUST drive pagination from `hasMore` / `nextCursor` (and
        // not from `insights.length < limit`). Verified at this commit:
        // no consumer derives end-of-list from the page length —
        // `frontend/.../use-monitoring.ts` reads `total`/`insights`, and
        // settings cursor-pagination drives off `nextCursor`.
        total: total?.count ?? 0,
        visibleTotal: filteredItems.length,
        sensitivity: preset,
        limit,
        offset,
        nextCursor,
        hasMore,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to query insights');
      return reply.code(500).send({ error: 'Failed to query insights', details: msg });
    }
  });

  fastify.get('/api/monitoring/insights/container/:containerId', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get anomaly explanations for a specific container',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { containerId } = request.params as { containerId: string };
    const { timeRange = '1h', metricType } = request.query as {
      timeRange?: string;
      metricType?: string;
    };

    try {
      const db = getDbForDomain('insights');

      // Parse timeRange into milliseconds and compute JS cutoff
      let intervalMs = 3600_000; // default 1 hour
      const match = timeRange.match(/^(\d+)([mhd])$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
          case 'm': intervalMs = value * 60_000; break;
          case 'h': intervalMs = value * 3600_000; break;
          case 'd': intervalMs = value * 86400_000; break;
        }
      }
      const cutoff = new Date(Date.now() - intervalMs).toISOString();

      const conditions = [
        '(container_id = ? OR container_id LIKE ?)',
        "category IN ('anomaly', 'predictive')",
        'created_at >= ?',
      ];
      const params: unknown[] = [containerId, `${containerId}%`, cutoff];

      if (metricType) {
        conditions.push('title LIKE ?');
        params.push(`%${metricType}%`);
      }

      const where = conditions.join(' AND ');
      const rows = await db.query<{
        id: string;
        severity: string;
        category: string;
        title: string;
        description: string;
        suggested_action: string | null;
        created_at: string;
      }>(`
        SELECT id, severity, category, title, description, suggested_action, created_at
        FROM insights
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 50
      `, [...params]);

      // Per-user Sensitivity post-filter (issue #1297) — drop anomaly
      // explanations below the user's effective z-score threshold before
      // returning. Non-anomaly rows (no parseable z-score) pass through.
      const userId = request.user?.sub;
      const preset = userId ? await getUserPreset(userId) : 'default';
      const defaults = getDefaultThresholds();
      const visibleRows = rows.filter((row) =>
        shouldIncludeAnomaly({ description: row.description, category: row.category }, preset, defaults),
      );

      // Parse out AI Analysis from description field
      const explanations = visibleRows.map((row) => {
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

      return { explanations, sensitivity: preset };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, containerId }, 'Failed to query container insights');
      return reply.code(500).send({ error: 'Failed to query container insights', details: msg });
    }
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
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const db = getDbForDomain('insights');
      await db.execute('UPDATE insights SET is_acknowledged = true WHERE id = ?', [id]);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, insightId: id }, 'Failed to acknowledge insight');
      return (reply as any).code(500).send({ error: 'Failed to acknowledge insight', details: msg });
    }
  });

  fastify.get('/api/security/audit', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get capability security audit for all endpoints',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (_request, reply) => {
    try {
      const entries = await opts.getSecurityAudit();
      return { entries };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch security audit');
      return reply.code(500).send({ error: 'Failed to fetch security audit', details: msg });
    }
  });

  fastify.get('/api/security/audit/:endpointId', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get capability security audit for one endpoint',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };
    const parsedEndpointId = Number(endpointId);
    try {
      const entries = await opts.getSecurityAudit(parsedEndpointId);
      return { entries };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, endpointId }, 'Failed to fetch security audit for endpoint');
      return reply.code(500).send({ error: 'Failed to fetch security audit for endpoint', details: msg });
    }
  });

  fastify.get('/api/security/ignore-list', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get security audit ignore list',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (_request, reply) => {
    try {
      return {
        key: opts.securityAuditIgnoreKey,
        category: 'security',
        defaults: opts.defaultSecurityAuditIgnorePatterns,
        patterns: await opts.getSecurityAuditIgnoreList(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch security ignore list');
      return reply.code(500).send({ error: 'Failed to fetch security ignore list', details: msg });
    }
  });

  fastify.put('/api/security/ignore-list', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Update security audit ignore list',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { patterns?: unknown };
    const patterns = Array.isArray(body?.patterns)
      ? body.patterns.filter((value): value is string => typeof value === 'string')
      : [];

    try {
      const saved = await opts.setSecurityAuditIgnoreList(patterns);
      return {
        success: true,
        key: opts.securityAuditIgnoreKey,
        category: 'security',
        patterns: saved,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to update security ignore list');
      return reply.code(500).send({ error: 'Failed to update security ignore list', details: msg });
    }
  });

  // ─── Per-user Sensitivity preset (issue #1297) ─────────────────────────
  // Personal preference — `authenticate` only, no `requireRole('admin')`.
  // GET returns the calling user's preset (default 'default' when unset);
  // PUT updates it after Zod-validating the body.

  fastify.get('/api/monitoring/sensitivity', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Get the calling user\'s anomaly sensitivity preset',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      // Defence-in-depth: authenticate hook should have set request.user
      // before this handler runs. If it didn't, treat as auth failure.
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    try {
      const preset = await getUserPreset(userId);
      return { preset };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, userId }, 'Failed to read sensitivity preset');
      return reply.code(500).send({ error: 'Failed to read sensitivity preset', details: msg });
    }
  });

  // Bearer-token auth via Authorization header — CSRF not a concern.
  fastify.put('/api/monitoring/sensitivity', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Update the calling user\'s anomaly sensitivity preset',
      security: [{ bearerAuth: [] }],
      body: SensitivityPutBodySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    const parsed = SensitivityPutBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.message });
    }
    try {
      await setUserPreset(userId, parsed.data.preset);
      return { preset: parsed.data.preset };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, userId }, 'Failed to update sensitivity preset');
      return reply.code(500).send({ error: 'Failed to update sensitivity preset', details: msg });
    }
  });
}
