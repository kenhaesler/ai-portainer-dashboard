import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    SQLITE_PATH: ':memory:',
  }),
}));

async function setupSessionsTable() {
  const { getDb } = await import('../db/sqlite.js');
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_active TEXT NOT NULL,
      is_valid INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec('DELETE FROM sessions');
  return db;
}

describe('session-store expiration semantics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('../db/sqlite.js');
    closeDb();
    vi.useRealTimers();
  });

  it('does not return expired sessions with ISO timestamps', async () => {
    const db = await setupSessionsTable();
    db.prepare(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      'expired-session',
      'user-1',
      'alice',
      '2026-02-07T09:00:00.000Z',
      '2026-02-07T09:30:00.000Z',
      '2026-02-07T09:15:00.000Z',
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const { getSession } = await import('./session-store.js');
    expect(getSession('expired-session')).toBeUndefined();
  });

  it('treats session expiring exactly at now as expired', async () => {
    const db = await setupSessionsTable();
    db.prepare(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      'boundary-session',
      'user-2',
      'bob',
      '2026-02-07T09:00:00.000Z',
      '2026-02-07T10:00:00.000Z',
      '2026-02-07T09:55:00.000Z',
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const { getSession } = await import('./session-store.js');
    expect(getSession('boundary-session')).toBeUndefined();
  });

  it('cleans expired and invalid sessions while preserving active ones', async () => {
    const db = await setupSessionsTable();
    db.prepare(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'expired-valid',
      'user-1',
      'alice',
      '2026-02-07T09:00:00.000Z',
      '2026-02-07T09:30:00.000Z',
      '2026-02-07T09:15:00.000Z',
      1,
    );
    db.prepare(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'future-invalid',
      'user-2',
      'bob',
      '2026-02-07T09:00:00.000Z',
      '2026-02-07T11:30:00.000Z',
      '2026-02-07T09:15:00.000Z',
      0,
    );
    db.prepare(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'future-valid',
      'user-3',
      'carol',
      '2026-02-07T09:00:00.000Z',
      '2026-02-07T11:30:00.000Z',
      '2026-02-07T09:15:00.000Z',
      1,
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const { cleanExpiredSessions } = await import('./session-store.js');
    expect(cleanExpiredSessions()).toBe(2);

    const remaining = db.prepare('SELECT id FROM sessions ORDER BY id').all() as Array<{ id: string }>;
    expect(remaining).toEqual([{ id: 'future-valid' }]);
  });
});
