import { Namespace } from 'socket.io';
import { z } from 'zod/v4';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { createSocketThrottle } from '@dashboard/core/utils/socket-throttle.js';

const log = createChildLogger('socket:remediation');
let remediationNamespace: Namespace | null = null;

// ─── Throttle ─────────────────────────────────────────────────────────
// 1 s cooldown for read events (actions:list). Same rationale as the
// monitoring namespace — protect the PG pool from rapid redundant reads.
const REMEDIATION_THROTTLE_MS = 1_000;
export const remediationThrottle = createSocketThrottle(REMEDIATION_THROTTLE_MS);

// ─── Payload validation ───────────────────────────────────────────────
// `status` is a free-form string in the existing route layer; restrict it
// here to the known action lifecycle states to prevent unbounded WHERE
// clauses (defense-in-depth — the underlying query already uses a
// parameterized placeholder).
const ACTION_STATUS_VALUES = [
  'pending',
  'approved',
  'rejected',
  'executing',
  'completed',
  'failed',
] as const;

const actionsListSchema = z
  .object({
    status: z.enum(ACTION_STATUS_VALUES).optional(),
  })
  .strict();

export function setupRemediationNamespace(ns: Namespace) {
  remediationNamespace = ns;
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';

    // Defence-in-depth: enforce admin role at the handler level as well
    if (socket.data.user?.role !== 'admin') {
      log.warn({ userId }, 'Remediation socket connection rejected: admin role required');
      socket.emit('error', { message: 'Admin role required' });
      socket.disconnect();
      return;
    }

    log.info({ userId }, 'Remediation client connected');

    // Send pending actions on connect
    socket.on('actions:list', async (data?: unknown) => {
      // ── Throttle ──
      const throttleResult = remediationThrottle.check(`actions:list:${userId}`);
      if (!throttleResult.allowed) {
        log.warn({ userId, retryAfterMs: throttleResult.retryAfterMs }, 'actions:list throttled');
        socket.emit('actions:throttled', {
          reason: 'Too many requests. Please wait before retrying.',
          retryAfterMs: throttleResult.retryAfterMs,
        });
        return;
      }

      // ── Validate payload ──
      const parsed = actionsListSchema.safeParse(data ?? {});
      if (!parsed.success) {
        log.warn({ userId, issues: parsed.error.issues }, 'actions:list rejected: invalid payload');
        socket.emit('actions:error', {
          error: 'Invalid arguments',
          code: 'INVALID_PAYLOAD',
          issues: parsed.error.issues,
        });
        return;
      }
      const { status } = parsed.data;

      try {
        const db = getDbForDomain('actions');
        let query = 'SELECT * FROM actions';
        const params: unknown[] = [];

        if (status) {
          query += ' WHERE status = ?';
          params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';
        const actions = await db.query(query, params);
        socket.emit('actions:list', { actions });
      } catch (err) {
        log.error({ err }, 'Failed to fetch actions');
        socket.emit('actions:error', { error: 'Failed to fetch actions' });
      }
    });

    socket.on('disconnect', () => {
      remediationThrottle.clearByUserId(userId);
      log.info({ userId }, 'Remediation client disconnected');
    });
  });
}

export function broadcastActionUpdate(action: Record<string, unknown>) {
  if (!remediationNamespace) return;
  remediationNamespace.emit('actions:updated', action);
}

export function broadcastNewAction(action: Record<string, unknown>) {
  if (!remediationNamespace) return;
  remediationNamespace.emit('actions:new', action);
}
