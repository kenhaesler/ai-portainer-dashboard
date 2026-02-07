import { v4 as uuidv4 } from 'uuid';
import { prepareStmt } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('session-store');

export interface Session {
  id: string;
  user_id: string;
  username: string;
  created_at: string;
  expires_at: string;
  last_active: string;
  is_valid: number;
}

export function createSession(userId: string, username: string): Session {
  const id = uuidv4();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  prepareStmt(`
    INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(id, userId, username, now, expiresAt, now);

  log.info({ sessionId: id, userId }, 'Session created');

  return {
    id,
    user_id: userId,
    username,
    created_at: now,
    expires_at: expiresAt,
    last_active: now,
    is_valid: 1,
  };
}

export function getSession(sessionId: string): Session | undefined {
  return prepareStmt(
    'SELECT * FROM sessions WHERE id = ? AND is_valid = 1 AND unixepoch(expires_at) > unixepoch(?)'
  ).get(sessionId, new Date().toISOString()) as Session | undefined;
}

export function invalidateSession(sessionId: string): void {
  prepareStmt('UPDATE sessions SET is_valid = 0 WHERE id = ?').run(sessionId);
  log.info({ sessionId }, 'Session invalidated');
}

export function refreshSession(sessionId: string): Session | undefined {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  prepareStmt(`
    UPDATE sessions SET expires_at = ?, last_active = ?
    WHERE id = ? AND is_valid = 1
  `).run(expiresAt, now, sessionId);

  return getSession(sessionId);
}

export function cleanExpiredSessions(): number {
  const result = prepareStmt(
    'DELETE FROM sessions WHERE unixepoch(expires_at) < unixepoch(?) OR is_valid = 0'
  ).run(new Date().toISOString());
  return result.changes;
}
