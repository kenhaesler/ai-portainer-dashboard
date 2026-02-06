import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    SQLITE_PATH: ':memory:',
  }),
}));

describe('sqlite prepareStmt', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('./sqlite.js');
    closeDb();
  });

  it('returns the same statement object for identical SQL', async () => {
    const { prepareStmt, getDb } = await import('./sqlite.js');
    // Ensure DB is initialized
    getDb();

    const sql = 'SELECT 1 as val';
    const stmt1 = prepareStmt(sql);
    const stmt2 = prepareStmt(sql);

    expect(stmt1).toBe(stmt2);
  });

  it('returns different statements for different SQL', async () => {
    const { prepareStmt, getDb } = await import('./sqlite.js');
    getDb();

    const stmt1 = prepareStmt('SELECT 1 as val');
    const stmt2 = prepareStmt('SELECT 2 as val');

    expect(stmt1).not.toBe(stmt2);
  });

  it('cached statement executes correctly', async () => {
    const { prepareStmt, getDb } = await import('./sqlite.js');
    getDb();

    const result = prepareStmt('SELECT ? + ? as sum').get(3, 4) as { sum: number };
    expect(result.sum).toBe(7);

    // Second call uses cached statement
    const result2 = prepareStmt('SELECT ? + ? as sum').get(10, 20) as { sum: number };
    expect(result2.sum).toBe(30);
  });

  it('cache is cleared on closeDb', async () => {
    const { prepareStmt, getDb, closeDb } = await import('./sqlite.js');
    getDb();

    const sql = 'SELECT 1 as val';
    const stmt1 = prepareStmt(sql);

    closeDb();
    // Re-open
    getDb();
    const stmt2 = prepareStmt(sql);

    // After close + re-open, should be a new statement
    expect(stmt1).not.toBe(stmt2);
  });
});

describe('session-store uses prepareStmt', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('./sqlite.js');
    closeDb();
  });

  it('createSession and getSession work with cached statements', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: vi.fn().mockReturnValue({ SQLITE_PATH: ':memory:' }),
    }));

    const { getDb } = await import('./sqlite.js');
    const db = getDb();

    // Create sessions table manually for test
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

    const { createSession, getSession } = await import('../services/session-store.js');

    const session = createSession('user-1', 'testuser');
    expect(session.user_id).toBe('user-1');
    expect(session.username).toBe('testuser');
    expect(session.is_valid).toBe(1);

    const retrieved = getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(session.id);
  });
});
