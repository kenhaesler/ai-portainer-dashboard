/**
 * stream-tickets — Short-lived single-use tickets for SSE auth (#1112).
 *
 * EventSource has no way to send a custom Authorization header, which forces
 * authentication into the URL. Putting a JWT into ?token=… leaks it to:
 *   - nginx access logs ($request includes query string)
 *   - browser history / address bar
 *   - any reverse proxy or SIEM that mirrors nginx logs verbatim
 *
 * The ticket exchange replaces the JWT with an opaque, single-use, 30-second
 * token. Tickets are minted via authenticated POST /api/auth/stream-ticket and
 * burned atomically on first use (UPDATE … WHERE used_at IS NULL RETURNING).
 *
 * Defence-in-depth (mandated by the user): the ticket itself is also scrubbed
 * from nginx access logs by a per-location log_format that omits $args. See
 * frontend/nginx.conf.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('stream-tickets');

/**
 * 30-second TTL — large enough to cover network latency between the ticket
 * POST and the EventSource open, small enough that an attacker who reads the
 * URL from nginx logs has a vanishing window to replay it (and even then,
 * the ticket is single-use).
 */
export const STREAM_TICKET_TTL_MS = 30_000;

export interface StreamTicket {
  id: string;
  user_id: string;
  username: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface IssuedTicket {
  ticket: string;
  expiresAt: string;
}

export interface ValidatedTicket {
  userId: string;
  username: string;
}

/**
 * Build a ticket id with high entropy. UUID v4 alone is 122 bits of entropy,
 * which is plenty, but we prefix with a tag so log lines are recognisable
 * and append cryptographically random bytes so the id is not a guessable
 * UUID even under a flawed RNG.
 */
function newTicketId(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `st_${uuidv4()}_${random}`;
}

/**
 * Create a single-use ticket for the given user. Returns the ticket id (to be
 * placed in the EventSource URL) and the absolute expiry timestamp.
 */
export async function createStreamTicket(
  userId: string,
  username: string,
): Promise<IssuedTicket> {
  const db = getDbForDomain('auth');
  const id = newTicketId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STREAM_TICKET_TTL_MS);

  await db.execute(
    `INSERT INTO stream_tickets (id, user_id, username, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, username, expiresAt.toISOString(), now.toISOString()],
  );

  log.debug({ userId, ticketId: id, expiresAt: expiresAt.toISOString() }, 'Stream ticket issued');

  return {
    ticket: id,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Atomically validate and consume a ticket. Returns the resolved user when
 * the ticket exists, has not expired, and has not been used. Returns null
 * for any failure (missing, expired, already used). The check-and-burn is
 * a single UPDATE … RETURNING so two concurrent SSE opens with the same
 * ticket cannot both succeed.
 */
export async function consumeStreamTicket(
  ticketId: string,
): Promise<ValidatedTicket | null> {
  if (!ticketId) return null;

  const db = getDbForDomain('auth');
  const now = new Date().toISOString();

  // Atomic single-statement claim. Race-free under READ COMMITTED because
  // the row-level UPDATE blocks until any concurrent UPDATE on the same
  // row commits/rolls back, and used_at IS NULL fails after the winner
  // commits — so the loser sees zero rows in RETURNING.
  const rows = await db.query<{ user_id: string; username: string }>(
    `UPDATE stream_tickets
       SET used_at = ?
     WHERE id = ?
       AND used_at IS NULL
       AND expires_at > ?
     RETURNING user_id, username`,
    [now, ticketId, now],
  );

  if (rows.length === 0) {
    log.debug({ ticketId }, 'Stream ticket rejected (missing/expired/used)');
    return null;
  }

  const row = rows[0];
  return { userId: row.user_id, username: row.username };
}

/**
 * Periodic sweeper — purge expired or already-used tickets older than the
 * TTL window. Called from the scheduler every 5 minutes. Returns the number
 * of rows deleted.
 */
export async function cleanExpiredStreamTickets(): Promise<number> {
  const db = getDbForDomain('auth');
  const now = new Date().toISOString();

  const result = await db.execute(
    `DELETE FROM stream_tickets
      WHERE expires_at < ?
         OR used_at IS NOT NULL`,
    [now],
  );
  return result.changes;
}
