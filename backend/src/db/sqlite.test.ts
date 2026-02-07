import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('migration 020_actions_pending_unique', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('deduplicates pending actions before adding the unique partial index', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'aidash-sqlite-'));
    const dbPath = join(tmpDir, 'dashboard.db');

    try {
      const seedDb = new Database(dbPath);
      seedDb.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS actions (
          id TEXT PRIMARY KEY,
          insight_id TEXT,
          endpoint_id INTEGER NOT NULL,
          container_id TEXT NOT NULL,
          container_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          rationale TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      const markMigration = seedDb.prepare('INSERT INTO _migrations (name) VALUES (?)');
      const migrationDir = join(process.cwd(), 'src/db/migrations');
      const previousMigrations = readdirSync(migrationDir)
        .filter((file) => file.endsWith('.sql') && file !== '020_actions_pending_unique.sql')
        .sort();
      const markAll = seedDb.transaction((names: string[]) => {
        for (const name of names) {
          markMigration.run(name);
        }
      });
      markAll(previousMigrations);

      const insert = seedDb.prepare(`
        INSERT INTO actions (
          id, insight_id, endpoint_id, container_id, container_name,
          action_type, rationale, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insert.run(
        'old-pending',
        null,
        1,
        'container-1',
        'api',
        'STOP_CONTAINER',
        'old pending',
        'pending',
        '2026-02-07T17:00:00.000Z',
      );
      insert.run(
        'new-pending',
        null,
        1,
        'container-1',
        'api',
        'STOP_CONTAINER',
        'new pending',
        'pending',
        '2026-02-07T18:00:00.000Z',
      );
      insert.run(
        'approved-duplicate',
        null,
        1,
        'container-1',
        'api',
        'STOP_CONTAINER',
        'approved row should remain',
        'approved',
        '2026-02-07T19:00:00.000Z',
      );
      seedDb.close();

      vi.doMock('../config/index.js', () => ({
        getConfig: vi.fn().mockReturnValue({ SQLITE_PATH: dbPath }),
      }));

      const { getDb, closeDb } = await import('./sqlite.js');
      const db = getDb();

      const rows = db
        .prepare(`
          SELECT id, status
          FROM actions
          WHERE container_id = ? AND action_type = ?
          ORDER BY created_at ASC
        `)
        .all('container-1', 'STOP_CONTAINER') as Array<{ id: string; status: string }>;

      const pendingRows = rows.filter((row) => row.status === 'pending');
      expect(pendingRows).toEqual([{ id: 'new-pending', status: 'pending' }]);
      expect(rows.some((row) => row.id === 'approved-duplicate')).toBe(true);

      const insertPending = () => db.prepare(`
        INSERT INTO actions (
          id, insight_id, endpoint_id, container_id, container_name,
          action_type, rationale, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'should-fail',
        null,
        1,
        'container-1',
        'api',
        'STOP_CONTAINER',
        'duplicate pending',
        'pending',
        '2026-02-07T20:00:00.000Z',
      );
      expect(insertPending).toThrow();

      closeDb();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
