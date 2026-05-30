import { Namespace } from 'socket.io';
import { z } from 'zod/v4';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { createSocketThrottle } from '@dashboard/core/utils/socket-throttle.js';

const log = createChildLogger('socket:monitoring');

// ─── Throttle ─────────────────────────────────────────────────────────
// 1 s cooldown for DB-read events (insights:history, investigations:history)
// and any other read events. Prevents a single client from hammering the
// PostgreSQL pool with rapid, redundant reads. Per (event × user) key.
const MONITORING_THROTTLE_MS = 1_000;
export const monitoringThrottle = createSocketThrottle(MONITORING_THROTTLE_MS);

// ─── Payload validation ───────────────────────────────────────────────
// Defense-in-depth bounds for unbounded `limit` (DoS via huge LIMIT) plus
// strict severity enum validation. SQL injection on `severity` is already
// blocked upstream by the parameterized query in the handler — these
// schemas reject malformed payloads before they reach SQL.
const SEVERITY_VALUES = ['critical', 'warning', 'info'] as const;

const insightsHistorySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).optional().default(50),
    severity: z.enum(SEVERITY_VALUES).optional(),
  })
  .strict();

const investigationsHistorySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  })
  .strict();

export function setupMonitoringNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'Monitoring client connected');

    // Send recent insights on connect
    socket.on('insights:history', async (data?: unknown) => {
      // ── Throttle ──
      const throttleResult = monitoringThrottle.check(`insights:history:${userId}`);
      if (!throttleResult.allowed) {
        log.warn({ userId, retryAfterMs: throttleResult.retryAfterMs }, 'insights:history throttled');
        socket.emit('insights:throttled', {
          reason: 'Too many requests. Please wait before retrying.',
          retryAfterMs: throttleResult.retryAfterMs,
        });
        return;
      }

      // ── Validate payload ──
      const parsed = insightsHistorySchema.safeParse(data ?? {});
      if (!parsed.success) {
        log.warn({ userId, issues: parsed.error.issues }, 'insights:history rejected: invalid payload');
        socket.emit('insights:error', {
          error: 'Invalid arguments',
          code: 'INVALID_PAYLOAD',
          issues: parsed.error.issues,
        });
        return;
      }
      const { limit, severity } = parsed.data;

      try {
        const db = getDbForDomain('insights');
        let query = 'SELECT * FROM insights';
        const params: unknown[] = [];

        if (severity) {
          query += ' WHERE severity = ?';
          params.push(severity);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const insights = await db.query(query, params);
        socket.emit('insights:history', { insights });
      } catch (err) {
        log.error({ err }, 'Failed to fetch insight history');
        socket.emit('insights:error', { error: 'Failed to fetch history' });
      }
    });

    // Send recent investigations on request
    socket.on('investigations:history', async (data?: unknown) => {
      // ── Throttle ──
      const throttleResult = monitoringThrottle.check(`investigations:history:${userId}`);
      if (!throttleResult.allowed) {
        log.warn({ userId, retryAfterMs: throttleResult.retryAfterMs }, 'investigations:history throttled');
        socket.emit('investigations:throttled', {
          reason: 'Too many requests. Please wait before retrying.',
          retryAfterMs: throttleResult.retryAfterMs,
        });
        return;
      }

      // ── Validate payload ──
      const parsed = investigationsHistorySchema.safeParse(data ?? {});
      if (!parsed.success) {
        log.warn({ userId, issues: parsed.error.issues }, 'investigations:history rejected: invalid payload');
        socket.emit('investigations:error', {
          error: 'Invalid arguments',
          code: 'INVALID_PAYLOAD',
          issues: parsed.error.issues,
        });
        return;
      }
      const { limit } = parsed.data;

      try {
        const db = getDbForDomain('investigations');
        const investigations = await db.query(
          `SELECT i.*, ins.title as insight_title, ins.severity as insight_severity, ins.category as insight_category
           FROM investigations i
           LEFT JOIN insights ins ON i.insight_id = ins.id
           ORDER BY i.created_at DESC LIMIT ?`,
          [limit]
        );

        socket.emit('investigations:history', { investigations });
      } catch (err) {
        log.error({ err }, 'Failed to fetch investigation history');
        socket.emit('investigations:error', { error: 'Failed to fetch investigation history' });
      }
    });

    socket.on('insights:subscribe', (data?: { severity?: string }) => {
      if (data?.severity) {
        socket.join(`severity:${data.severity}`);
      } else {
        socket.join('severity:all');
      }
    });

    socket.on('insights:unsubscribe', () => {
      socket.rooms.forEach((room) => {
        if (room.startsWith('severity:')) socket.leave(room);
      });
    });

    socket.on('disconnect', () => {
      monitoringThrottle.clearByUserId(userId);
      log.info({ userId }, 'Monitoring client disconnected');
    });
  });
}

// Call this from monitoring-service when new insights are generated
export function broadcastInsight(ns: Namespace, insight: Record<string, unknown>) {
  const severity = insight.severity as string;
  ns.to(`severity:${severity}`).emit('insights:new', insight);
  ns.to('severity:all').emit('insights:new', insight);
}

/**
 * Broadcast a batch of insights in a single event.
 * Also emits individual `insights:new` events per severity room for backward compatibility.
 */
export function broadcastInsightBatch(ns: Namespace, insights: Array<Record<string, unknown>>) {
  if (insights.length === 0) return;

  // Batch event for clients that support it
  ns.to('severity:all').emit('insights:batch', insights);

  // Per-severity room broadcasts for backward compat
  for (const insight of insights) {
    const severity = insight.severity as string;
    ns.to(`severity:${severity}`).emit('insights:new', insight);
  }
}
