import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config/index.js';
import { getDbForDomain } from '../db/app-db-router.js';
import { writeAuditLog } from './audit-logger.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('session-store');

/**
 * Session TTL — derived from the same `JWT_TOKEN_EXPIRY_MINUTES` env var as
 * the signed JWT `exp` claim. Keeping a single source of truth guarantees a
 * token can never outlive its session row (and vice versa).
 */
function getSessionTtlMs(): number {
  return getConfig().JWT_TOKEN_EXPIRY_MINUTES * 60_000;
}

/**
 * Maximum retry attempts when a SERIALIZABLE transaction fails with PostgreSQL
 * error code `40001` (serialization_failure) during concurrent createSession calls.
 * 3 attempts is sufficient under realistic login concurrency; further conflicts
 * indicate a hot-spot worth surfacing.
 */
const SERIALIZATION_RETRY_LIMIT = 3;

/** PostgreSQL serialization_failure error code. */
const PG_SERIALIZATION_FAILURE = '40001';

export interface Session {
  id: string;
  user_id: string;
  username: string;
  created_at: string;
  expires_at: string;
  last_active: string;
  is_valid: boolean;
}

interface PgError {
  code?: string;
}

function isSerializationFailure(err: unknown): boolean {
  return typeof err === 'object'
    && err !== null
    && (err as PgError).code === PG_SERIALIZATION_FAILURE;
}

/**
 * Create a new session for `userId`/`username`, enforcing the per-user concurrent
 * session cap (`MAX_CONCURRENT_SESSIONS_PER_USER`).
 *
 * Atomic eviction (issue #1107):
 *   - All work runs inside a SERIALIZABLE transaction so concurrent createSession
 *     calls for the same user cannot both observe the same pre-eviction count
 *     (the READ COMMITTED race called out in CRITIC-FINDINGS §B3/C2).
 *   - On `40001 serialization_failure`, the transaction retries up to
 *     `SERIALIZATION_RETRY_LIMIT` times. Under realistic login concurrency this
 *     converges quickly; the post-condition is `count(valid sessions) <= max`.
 *   - Evicted sessions are deleted (not soft-invalidated) so the row count
 *     constraint is enforced by physical deletion. An audit-log entry
 *     (`session.evicted`) is written for each eviction batch.
 */
export async function createSession(userId: string, username: string): Promise<Session> {
  const db = getDbForDomain('auth');
  const cfg = getConfig();
  const maxSessions = cfg.MAX_CONCURRENT_SESSIONS_PER_USER;
  const id = uuidv4();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();

  let lastErr: unknown;
  for (let attempt = 0; attempt < SERIALIZATION_RETRY_LIMIT; attempt++) {
    try {
      const evictedIds = await db.transaction(async (tx) => {
        // First statement of the tx — establishes isolation level for this connection.
        await tx.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

        // Count currently-valid sessions for this user. Under SERIALIZABLE, this read
        // participates in conflict detection so a concurrent INSERT/DELETE that would
        // change the result will trigger a 40001 retry rather than a silent race.
        const countRow = await tx.queryOne<{ count: string | number }>(
          `SELECT count(*)::int AS count FROM sessions
           WHERE user_id = ? AND is_valid = true AND expires_at > ?`,
          [userId, now],
        );
        const validCount = Number(countRow?.count ?? 0);

        // Evict oldest if we would exceed the cap after inserting the new row.
        // toEvict = max(0, validCount + 1 - maxSessions) so post-INSERT count == maxSessions.
        const toEvict = Math.max(0, validCount + 1 - maxSessions);
        let evicted: string[] = [];

        if (toEvict > 0) {
          const evictedRows = await tx.query<{ id: string }>(
            `DELETE FROM sessions
             WHERE id IN (
               SELECT id FROM sessions
               WHERE user_id = ? AND is_valid = true AND expires_at > ?
               ORDER BY created_at ASC
               LIMIT ?
             )
             RETURNING id`,
            [userId, now, toEvict],
          );
          evicted = evictedRows.map((r) => r.id);
        }

        await tx.execute(
          `INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
           VALUES (?, ?, ?, ?, ?, ?, true)`,
          [id, userId, username, now, expiresAt, now],
        );

        return evicted;
      });

      log.info({ sessionId: id, userId, evictedCount: evictedIds.length }, 'Session created');

      // Audit-log eviction outside the transaction so a slow audit write does not
      // hold session-store row locks. Best-effort; writeAuditLog already swallows errors.
      if (evictedIds.length > 0) {
        await writeAuditLog({
          user_id: userId,
          username,
          action: 'session.evicted',
          target_type: 'session',
          target_id: id, // the session that triggered the eviction
          details: {
            evicted_session_ids: evictedIds,
            reason: 'max_concurrent_sessions_exceeded',
            max_concurrent_sessions: maxSessions,
          },
        });
        log.info(
          { userId, evictedSessionIds: evictedIds, max: maxSessions },
          'Evicted oldest sessions due to MAX_CONCURRENT_SESSIONS_PER_USER',
        );
      }

      return {
        id,
        user_id: userId,
        username,
        created_at: now,
        expires_at: expiresAt,
        last_active: now,
        is_valid: true,
      };
    } catch (err) {
      lastErr = err;
      if (!isSerializationFailure(err)) {
        throw err;
      }
      log.warn(
        { userId, attempt: attempt + 1, max: SERIALIZATION_RETRY_LIMIT },
        'createSession serialization failure, retrying',
      );
    }
  }

  // All retries exhausted — surface the underlying serialization error.
  throw lastErr instanceof Error
    ? lastErr
    : new Error('createSession: serialization failure after retries');
}

export async function getSession(sessionId: string): Promise<Session | undefined> {
  const db = getDbForDomain('auth');
  const row = await db.queryOne<Session>(
    'SELECT * FROM sessions WHERE id = ? AND is_valid = true AND expires_at > ?',
    [sessionId, new Date().toISOString()],
  );
  return row ?? undefined;
}

export async function invalidateSession(sessionId: string): Promise<void> {
  const db = getDbForDomain('auth');
  await db.execute('UPDATE sessions SET is_valid = false WHERE id = ?', [sessionId]);
  log.info({ sessionId }, 'Session invalidated');
}

export async function refreshSession(sessionId: string): Promise<Session | undefined> {
  const db = getDbForDomain('auth');
  const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();
  const now = new Date().toISOString();

  await db.execute(`
    UPDATE sessions SET expires_at = ?, last_active = ?
    WHERE id = ? AND is_valid = true AND expires_at > ?
  `, [expiresAt, now, sessionId, now]);

  return getSession(sessionId);
}

export async function cleanExpiredSessions(): Promise<number> {
  const db = getDbForDomain('auth');
  const result = await db.execute(
    'DELETE FROM sessions WHERE expires_at < ? OR is_valid = false',
    [new Date().toISOString()],
  );
  return result.changes;
}
