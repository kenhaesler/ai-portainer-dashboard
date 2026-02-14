import { v4 as uuidv4 } from 'uuid';
import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('session-store');

export interface Session {
  id: string;
  user_id: string;
  username: string;
  created_at: string;
  expires_at: string;
  last_active: string;
  is_valid: boolean;
}

export async function createSession(userId: string, username: string): Promise<Session> {
  const db = getDbForDomain('auth');
  const id = uuidv4();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await db.execute(`
    INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
    VALUES (?, ?, ?, ?, ?, ?, true)
  `, [id, userId, username, now, expiresAt, now]);

  log.info({ sessionId: id, userId }, 'Session created');

  return {
    id,
    user_id: userId,
    username,
    created_at: now,
    expires_at: expiresAt,
    last_active: now,
    is_valid: true,
  };
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
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db.execute(`
    UPDATE sessions SET expires_at = ?, last_active = ?
    WHERE id = ? AND is_valid = true
  `, [expiresAt, now, sessionId]);

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
