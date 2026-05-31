import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { InsightsQuerySchema, InsightIdParamsSchema, SuccessResponseSchema } from '@dashboard/core/models/api-schemas.js';
import { ANOMALY_DETECTORS } from '@dashboard/core/models/monitoring.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import {
  SensitivityPutBodySchema,
  getUserPreset,
  setUserPreset,
  shouldIncludeAnomaly,
  getDefaultThresholds,
} from '../services/sensitivity-preset.js';

const log = createChildLogger('route:monitoring');

// ── Anomaly feedback Zod schemas — issue #1298 ─────────────────────
// Currently only 'false-positive' is accepted at the API surface; the
// DB CHECK constraint reserves 'true-positive' and 'unsure' for future
// dispositions so they can be added without another migration.
const AnomalyFeedbackBodySchema = z.object({
  anomalyId: z.string().min(1).max(200),
  disposition: z.literal('false-positive').optional().default('false-positive'),
  // Detector source — denormalised onto the feedback row so the rate
  // calculation works for correlated anomalies (which never appear in the
  // `insights` table). Optional. Constrained to the canonical allowlist
  // ANOMALY_DETECTORS (persisted + in-memory) from
  // packages/core/src/models/monitoring.ts — single source of truth (#1314).
  detector: z.enum(ANOMALY_DETECTORS).optional(),
});

const AnomalyFeedbackResponseSchema = z.object({
  success: z.boolean(),
  anomalyId: z.string(),
  disposition: z.string(),
  duplicate: z.boolean(),
});

const AnomalyFeedbackRatesQuerySchema = z.object({
  // Admins can opt back into caller-scoped mode by passing scope=mine.
  // Non-admins always get caller-scoped data regardless of the value.
  scope: z.enum(['mine', 'fleet']).optional(),
});

interface RateRow {
  detector: string;
  anomalies: number;
  false_positives: number;
}

interface DetectorRate {
  detector: string;
  anomalies: number;
  falsePositives: number;
  rate: number;
}

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
      // without a z-score column value (e.g. predictive forecasts) always
      // pass through.
      const userId = request.user?.sub;
      const preset = userId ? await getUserPreset(userId) : 'default';
      const defaults = getDefaultThresholds();
      const filteredItems = items.filter((i) =>
        shouldIncludeAnomaly(
          {
            z_score: i.z_score as number | string | null,
            category: i.category as string | null | undefined,
          },
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
        z_score: number | string | null;
      }>(`
        SELECT id, severity, category, title, description, suggested_action, created_at, z_score
        FROM insights
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 50
      `, [...params]);

      // Per-user Sensitivity post-filter (issue #1297) — drop anomaly
      // explanations below the user's effective z-score threshold before
      // returning. Rows without a z-score column value pass through.
      const userId = request.user?.sub;
      const preset = userId ? await getUserPreset(userId) : 'default';
      const defaults = getDefaultThresholds();
      const visibleRows = rows.filter((row) =>
        shouldIncludeAnomaly({ z_score: row.z_score, category: row.category }, preset, defaults),
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

  // ── Anomaly feedback (issue #1298) ───────────────────────────────
  //
  // POST /api/monitoring/anomaly-feedback
  //   Records one feedback row per (anomaly, user). Idempotent on
  //   resubmission via ON CONFLICT DO NOTHING — the existing row's
  //   created_at is preserved and `duplicate: true` is returned so
  //   the caller can hide the "submitted" toast on retry.
  fastify.post('/api/monitoring/anomaly-feedback', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Record false-positive (or future disposition) feedback for an anomaly',
      security: [{ bearerAuth: [] }],
      body: AnomalyFeedbackBodySchema,
      response: { 200: AnomalyFeedbackResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return (reply as any).code(401).send({ error: 'Unauthorized' });
    }

    const { anomalyId, disposition, detector } = request.body as z.infer<typeof AnomalyFeedbackBodySchema>;

    try {
      const db = getDbForDomain('feedback');
      // ON CONFLICT (anomaly_id, user_id) DO NOTHING enforces the "one
      // disposition per user per anomaly" rule from the migration. The
      // `RETURNING id` clause is the race-free way to detect whether
      // this request actually inserted a row: PostgreSQL returns the
      // id when the row was newly inserted and zero rows when the
      // ON CONFLICT branch fired. Comparing wall-clock to created_at
      // (the previous approach) was prone to GC pauses, clock skew,
      // and slow round-trips flipping the duplicate flag in either
      // direction.
      const inserted = await db.query<{ id: number }>(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition, detector)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (anomaly_id, user_id) DO NOTHING
         RETURNING id`,
        [anomalyId, userId, disposition, detector ?? null],
      );

      // For the duplicate case we still need the persisted disposition
      // (the API contract returns whatever the DB has, not whatever
      // the client sent on the second attempt). Only the duplicate
      // branch needs a follow-up SELECT.
      let persistedDisposition = disposition;
      const duplicate = inserted.length === 0;
      if (duplicate) {
        const existing = await db.queryOne<{ disposition: string }>(
          `SELECT disposition FROM anomaly_feedback
           WHERE anomaly_id = ? AND user_id = ?`,
          [anomalyId, userId],
        );
        if (!existing) {
          // Structurally impossible: ON CONFLICT fired (row existed)
          // yet the SELECT returns nothing. Could only happen if the
          // row was cascade-deleted between the two queries (e.g.
          // user deletion mid-request) — surface as 500 rather than
          // masking with success.
          log.error({ anomalyId, userId }, 'Feedback row missing after conflict');
          return (reply as any).code(500).send({ error: 'Failed to record feedback' });
        }
        persistedDisposition = existing.disposition as typeof disposition;
      }

      return {
        success: true,
        anomalyId,
        disposition: persistedDisposition,
        duplicate,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, anomalyId, userId }, 'Failed to record anomaly feedback');
      return (reply as any).code(500).send({ error: 'Failed to record anomaly feedback', details: msg });
    }
  });

  // GET /api/monitoring/anomaly-feedback/rates
  //   Returns per-detector false-positive rate. Caller-scoped by default;
  //   admins receive fleet-wide data and may opt back into caller-scope
  //   via ?scope=mine. Non-admins are always scoped to their own
  //   feedback regardless of the `scope` parameter (privacy guarantee).
  //
  //   Admin fleet-wide aggregate exposes counts per detector only —
  //   never individual user dispositions.
  fastify.get('/api/monitoring/anomaly-feedback/rates', {
    schema: {
      tags: ['Monitoring'],
      summary: 'Per-detector anomaly false-positive rates (caller-scoped; admins see fleet-wide)',
      security: [{ bearerAuth: [] }],
      querystring: AnomalyFeedbackRatesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const userId = request.user?.sub;
    const role = request.user?.role;
    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { scope } = request.query as z.infer<typeof AnomalyFeedbackRatesQuerySchema>;
    const isAdmin = role === 'admin';
    // Non-admins are forced to caller scope. Admins default to fleet
    // unless they explicitly request scope=mine.
    const fleetWide = isAdmin && scope !== 'mine';

    try {
      const db = getDbForDomain('feedback');

      // The rate has two contributing sources:
      //
      //   1. Insights-backed: rows in the `insights` table where
      //      `category IN ('anomaly', 'predictive')`. The detector is
      //      `insights.detection_method` (migration 030). Feedback
      //      rows linked by `anomaly_id = insights.id`.
      //
      //   2. Correlated anomalies: results from the in-memory
      //      `detectCorrelatedAnomalies` service. These have no
      //      `insights` row, so feedback carries the detector tag
      //      itself (`anomaly_feedback.detector`).
      //
      // We compute the rate as a UNION of both sources, grouped by
      // detector. `anomalies` is the count of distinct anomaly IDs
      // referenced by feedback rows + the count of un-flagged
      // insights, by detector.
      //
      // For caller-scoped mode we filter feedback by `user_id = ?`;
      // for fleet mode we count every user's feedback. We never
      // restrict the `insights` denominator by user — operators all
      // see the same anomaly stream — but we DO restrict the
      // numerator (false_positives) to the calling user when caller-
      // scoped, so the rate reflects "of the anomalies I saw, how
      // many did I personally mark false?".
      const userClause = fleetWide ? '' : 'AND f.user_id = ?';
      const userParam = fleetWide ? [] : [userId];

      const rows = await db.query<RateRow>(
        `WITH insights_anomalies AS (
           SELECT
             id,
             COALESCE(detection_method, 'unknown') AS detector
           FROM insights
           WHERE category IN ('anomaly', 'predictive')
         ),
         insight_rates AS (
           SELECT
             i.detector,
             COUNT(DISTINCT i.id)::integer AS anomalies,
             COUNT(DISTINCT f.id)::integer AS false_positives
           FROM insights_anomalies i
           LEFT JOIN anomaly_feedback f
             ON f.anomaly_id = i.id
             AND f.disposition = 'false-positive'
             ${userClause}
           GROUP BY i.detector
         ),
         correlated_rates AS (
           -- Feedback rows whose anomaly_id is NOT in the insights
           -- table — these are correlated anomalies, which are
           -- computed on demand and never persisted, so there is no
           -- "denominator of all surfaced anomalies" available
           -- server-side. We approximate the rate from feedback alone:
           --   * denominator = COUNT(DISTINCT anomaly_id) — unique
           --     correlated anomalies that received any feedback,
           --   * numerator   = COUNT(*) — total false-positive votes,
           --     including the multi-user "two operators flag the
           --     same correlated anomaly" case.
           -- Dropping DISTINCT on the numerator means rate > 1 is
           -- possible when multiple users mark the same correlated
           -- anomaly; the JS layer clamps the surfaced rate to [0, 1]
           -- (raw counts remain accurate). This is intentional — it
           -- preserves the "stronger signal when multiple operators
           -- agree" semantic instead of always yielding the trivial
           -- rate=1 the previous COUNT(DISTINCT)/COUNT(DISTINCT)
           -- formulation produced.
           SELECT
             COALESCE(f.detector, 'unknown') AS detector,
             COUNT(DISTINCT f.anomaly_id)::integer AS anomalies,
             COUNT(*)::integer AS false_positives
           FROM anomaly_feedback f
           WHERE f.disposition = 'false-positive'
             AND NOT EXISTS (SELECT 1 FROM insights i WHERE i.id = f.anomaly_id)
             ${userClause}
           GROUP BY COALESCE(f.detector, 'unknown')
         )
         SELECT
           detector,
           SUM(anomalies)::integer AS anomalies,
           SUM(false_positives)::integer AS false_positives
         FROM (
           SELECT * FROM insight_rates
           UNION ALL
           SELECT * FROM correlated_rates
         ) combined
         GROUP BY detector
         ORDER BY detector`,
        [...userParam, ...userParam],
      );

      const rates: DetectorRate[] = rows.map((row) => {
        // Correlated-anomaly rows can produce false_positives > anomalies
        // (the denominator only counts correlated IDs that received any
        // feedback, while the numerator counts every vote, so two
        // operators marking the same correlated anomaly contributes 2/1).
        // The same can happen on the insight_rates branch in fleet mode:
        // the numerator (COUNT(DISTINCT f.id), PK-distinct so effectively
        // per-row) divided by the denominator (COUNT(DISTINCT i.id), per
        // insight) can exceed 1 when multiple users file feedback on the
        // same persisted insight. Clamp the displayed rate to [0, 1] so
        // the UI badge doesn't render values like 200%. The raw counts
        // remain available to any caller that wants the underlying signal.
        const rawRate = row.anomalies > 0 ? row.false_positives / row.anomalies : 0;
        return {
          detector: row.detector,
          anomalies: row.anomalies,
          falsePositives: row.false_positives,
          rate: Math.min(rawRate, 1),
        };
      });

      return { rates, scope: fleetWide ? 'fleet' : 'mine' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, userId }, 'Failed to compute anomaly feedback rates');
      return reply.code(500).send({ error: 'Failed to compute anomaly feedback rates', details: msg });
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
