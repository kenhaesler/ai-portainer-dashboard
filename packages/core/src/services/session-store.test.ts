import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setConfigForTest, resetConfig } from '../config/index.js';

// In-memory store for mock DB
interface MockRow {
  id: string;
  user_id: string;
  username: string;
  created_at: string;
  expires_at: string;
  last_active: string;
  is_valid: 0 | 1;
}
const sessionStore: Map<string, MockRow> = new Map();

// Capture audit-log calls so tests can assert on session.evicted events.
const auditLogCalls: Array<Record<string, unknown>> = [];

// Capture the order of SQL operations within createSession so tests can assert
// that pg_advisory_xact_lock runs BEFORE count/delete/insert.
type SqlOpKind = 'advisory_lock' | 'count' | 'delete' | 'insert' | 'other';
const sqlOpLog: Array<{ kind: SqlOpKind; params: unknown[] }> = [];

function classifySql(sql: string): SqlOpKind {
  if (sql.includes('pg_advisory_xact_lock')) return 'advisory_lock';
  if (sql.includes('SELECT count(*)') && sql.includes('FROM sessions')) return 'count';
  if (sql.includes('DELETE FROM sessions') && sql.includes('RETURNING id')) return 'delete';
  if (sql.includes('INSERT INTO sessions')) return 'insert';
  return 'other';
}

// Kept: in-memory audit logger mock — avoids DB dependency from session-store imports.
vi.mock('./audit-logger.js', () => ({
  writeAuditLog: vi.fn(async (entry: Record<string, unknown>) => {
    auditLogCalls.push(entry);
  }),
}));

// Kept: in-memory mock for perf benchmarks + atomic-eviction unit tests;
// real PG tests live in session-store.integration.test.ts.
vi.mock('../db/app-db-router.js', () => {
  // Helpers shared between the top-level mockDb and tx mockDb (they're the same instance).
  function selectValidForUser(userId: string, now: string): MockRow[] {
    return Array.from(sessionStore.values())
      .filter((r) => r.user_id === userId && r.is_valid === 1 && r.expires_at > now)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  const mockDb: Record<string, unknown> = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqlOpLog.push({ kind: classifySql(sql), params });
      if (sql.includes('pg_advisory_xact_lock')) {
        // Per-user advisory lock — no-op in the in-memory mock; real-PG behaviour
        // is exercised in session-store.integration.test.ts.
        return { changes: 0 };
      }
      if (sql.includes('INSERT INTO sessions')) {
        const row: MockRow = {
          id: params[0] as string,
          user_id: params[1] as string,
          username: params[2] as string,
          created_at: params[3] as string,
          expires_at: params[4] as string,
          last_active: params[5] as string,
          is_valid: 1,
        };
        sessionStore.set(row.id, row);
        return { changes: 1 };
      }
      if (sql.includes('UPDATE sessions SET expires_at')) {
        // refreshSession
        const expiresAt = params[0];
        const lastActive = params[1];
        const id = params[2] as string;
        const nowParam = params[3] as string;
        const existing = sessionStore.get(id);
        if (existing && existing.is_valid === 1 && existing.expires_at > nowParam) {
          existing.expires_at = expiresAt as string;
          existing.last_active = lastActive as string;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (sql.includes('UPDATE sessions SET is_valid = false')) {
        const id = params[0] as string;
        const existing = sessionStore.get(id);
        if (existing) existing.is_valid = 0;
        return { changes: existing ? 1 : 0 };
      }
      if (sql.includes('DELETE FROM sessions')
          && sql.includes('expires_at <')
          && !sql.includes('user_id')) {
        // cleanExpiredSessions path
        const now = params[0] as string;
        let deleted = 0;
        for (const [id, row] of sessionStore) {
          if (row.expires_at < now || row.is_valid === 0) {
            sessionStore.delete(id);
            deleted++;
          }
        }
        return { changes: deleted };
      }
      return { changes: 0 };
    }),
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqlOpLog.push({ kind: classifySql(sql), params });
      if (sql.includes('SELECT count(*)') && sql.includes('FROM sessions')) {
        const userId = params[0] as string;
        const now = params[1] as string;
        return { count: selectValidForUser(userId, now).length };
      }
      if (sql.includes('FROM sessions WHERE id')) {
        const id = params[0] as string;
        const now = params[1] as string;
        const row = sessionStore.get(id);
        if (row && row.is_valid === 1 && row.expires_at > now) {
          return row;
        }
        return null;
      }
      return null;
    }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqlOpLog.push({ kind: classifySql(sql), params });
      if (sql.includes('DELETE FROM sessions') && sql.includes('RETURNING id')) {
        const userId = params[0] as string;
        const now = params[1] as string;
        const limit = params[2] as number;
        const oldest = selectValidForUser(userId, now).slice(0, limit);
        const ids: { id: string }[] = [];
        for (const r of oldest) {
          sessionStore.delete(r.id);
          ids.push({ id: r.id });
        }
        return ids;
      }
      return [];
    }),
    transaction: vi.fn(async (fn: (db: typeof mockDb) => Promise<unknown>) => {
      // Mock transactions just delegate to the same in-memory mockDb. The atomic
      // eviction concurrency contract is exercised in the real-PG integration test.
      return fn(mockDb);
    }),
    healthCheck: vi.fn(async () => true),
  };
  return { getDbForDomain: vi.fn(() => mockDb) };
});

import {
  createSession,
  getSession,
  invalidateSession,
  refreshSession,
  cleanExpiredSessions,
} from './session-store.js';

describe('session-store performance benchmarks', () => {
  beforeEach(() => {
    sessionStore.clear();
    auditLogCalls.length = 0;
    // Ensure default max so perf tests don't trigger eviction.
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 100 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('session lookup completes in under 2ms (PostgreSQL target)', async () => {
    // Create a session
    const session = await createSession('user-123', 'alice');

    // Warm up (first query may be slower due to connection)
    await getSession(session.id);

    // Benchmark: measure 100 lookups
    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await getSession(session.id);
    }

    const end = performance.now();
    const avgMs = (end - start) / iterations;

    // Target: <2ms average per lookup (as specified in issue #650)
    expect(avgMs).toBeLessThan(2);
  });

  it('session creation completes in under 5ms', async () => {
    const iterations = 50;
    const start = performance.now();
    const sessions = [];

    for (let i = 0; i < iterations; i++) {
      const session = await createSession(`user-${i}`, `user${i}`);
      sessions.push(session);
    }

    const end = performance.now();
    const avgMs = (end - start) / iterations;

    // Session creation should be reasonably fast
    expect(avgMs).toBeLessThan(5);
    expect(sessions).toHaveLength(iterations);
  });

  it('session invalidation completes in under 3ms', async () => {
    // Create sessions to invalidate
    const sessions = await Promise.all(
      Array.from({ length: 50 }, (_, i) => createSession(`user-${i}`, `user${i}`))
    );

    const iterations = sessions.length;
    const start = performance.now();

    for (const session of sessions) {
      await invalidateSession(session.id);
    }

    const end = performance.now();
    const avgMs = (end - start) / iterations;

    expect(avgMs).toBeLessThan(3);
  });
});

describe('session-store expiration semantics', () => {
  beforeEach(() => {
    sessionStore.clear();
    auditLogCalls.length = 0;
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetConfig();
  });

  it('does not return expired sessions with ISO timestamps', async () => {
    // Insert an already-expired session directly into mock store
    sessionStore.set('expired-session', {
      id: 'expired-session',
      user_id: 'user-1',
      username: 'alice',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T09:30:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 1,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const session = await getSession('expired-session');
    expect(session).toBeUndefined();
  });

  it('treats session expiring exactly at now as expired', async () => {
    sessionStore.set('boundary-session', {
      id: 'boundary-session',
      user_id: 'user-2',
      username: 'bob',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T10:00:00.000Z',
      last_active: '2026-02-07T09:55:00.000Z',
      is_valid: 1,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const session = await getSession('boundary-session');
    expect(session).toBeUndefined();
  });

  it('refreshSession returns undefined for an expired but valid session', async () => {
    // Insert an already-expired session (is_valid = true but expires_at in the past)
    sessionStore.set('expired-but-valid', {
      id: 'expired-but-valid',
      user_id: 'user-10',
      username: 'dave',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T09:30:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 1,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const result = await refreshSession('expired-but-valid');
    expect(result).toBeUndefined();

    // Verify the session was NOT updated (expires_at should remain unchanged)
    const stored = sessionStore.get('expired-but-valid');
    expect(stored?.expires_at).toBe('2026-02-07T09:30:00.000Z');
  });

  it('refreshSession succeeds for a valid non-expired session', async () => {
    // Insert a valid, non-expired session
    sessionStore.set('valid-session', {
      id: 'valid-session',
      user_id: 'user-11',
      username: 'eve',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 1,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const result = await refreshSession('valid-session');
    expect(result).toBeDefined();
    expect(result?.id).toBe('valid-session');
    // expires_at should be updated to ~1 hour from now
    expect(new Date(result!.expires_at).getTime()).toBeGreaterThan(
      new Date('2026-02-07T10:00:00.000Z').getTime()
    );
  });

  it('cleans expired and invalid sessions while preserving active ones', async () => {
    // Expired but valid
    sessionStore.set('expired-valid', {
      id: 'expired-valid',
      user_id: 'user-1',
      username: 'alice',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T09:30:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 1,
    });
    // Future but invalid
    sessionStore.set('future-invalid', {
      id: 'future-invalid',
      user_id: 'user-2',
      username: 'bob',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T11:30:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 0,
    });
    // Future and valid — should survive
    sessionStore.set('future-valid', {
      id: 'future-valid',
      user_id: 'user-3',
      username: 'carol',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T11:30:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 1,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const cleaned = await cleanExpiredSessions();
    expect(cleaned).toBe(2);
    expect(sessionStore.size).toBe(1);
    expect(sessionStore.has('future-valid')).toBe(true);
  });
});

describe('session-store configurable TTL (issue #1106)', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  afterEach(() => {
    resetConfig();
  });

  it('createSession honors the configured JWT_TOKEN_EXPIRY_MINUTES', async () => {
    setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 30 });

    const session = await createSession('user-cfg-1', 'cfgalice');

    const ttlMs =
      new Date(session.expires_at).getTime() - new Date(session.created_at).getTime();
    // Allow 1s clock-skew tolerance from Date.now() vs new Date().toISOString() ordering.
    expect(ttlMs).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it('createSession honors a 5-minute lower bound', async () => {
    setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 5 });

    const session = await createSession('user-cfg-2', 'cfgbob');

    const ttlMs =
      new Date(session.expires_at).getTime() - new Date(session.created_at).getTime();
    expect(ttlMs).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });

  it('createSession honors a 1440-minute upper bound', async () => {
    setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 1440 });

    const session = await createSession('user-cfg-3', 'cfgcarol');

    const ttlMs =
      new Date(session.expires_at).getTime() - new Date(session.created_at).getTime();
    expect(ttlMs).toBeGreaterThanOrEqual(1440 * 60_000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(1440 * 60_000 + 1000);
  });

  it('refreshSession extends the session by the configured TTL', async () => {
    setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 45 });

    // Seed a valid session that hasn't expired yet.
    sessionStore.set('refresh-target', {
      id: 'refresh-target',
      user_id: 'user-cfg-4',
      username: 'cfgdave',
      created_at: '2026-02-07T09:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T09:15:00.000Z',
      is_valid: 1,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-07T10:00:00.000Z'));

    const result = await refreshSession('refresh-target');
    expect(result).toBeDefined();

    const ttlMs =
      new Date(result!.expires_at).getTime() -
      new Date('2026-02-07T10:00:00.000Z').getTime();
    expect(ttlMs).toBe(45 * 60_000);

    vi.useRealTimers();
  });
});

/**
 * Unit-level coverage of the MAX_CONCURRENT_SESSIONS_PER_USER eviction (#1107).
 * The full atomic-under-concurrency contract is asserted in the real-PG
 * integration test (session-store.integration.test.ts) — single-process mock
 * cannot prove the per-user advisory-lock mutual-exclusion contract.
 */
describe('session-store max concurrent sessions (#1107)', () => {
  beforeEach(() => {
    sessionStore.clear();
    auditLogCalls.length = 0;
    sqlOpLog.length = 0;
  });

  afterEach(() => {
    resetConfig();
  });

  it('allows exactly MAX sessions for a single user without eviction', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 5 });

    const sessions = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(await createSession('user-cap', `alice${i}`));
    }

    const valid = Array.from(sessionStore.values()).filter(
      (r) => r.user_id === 'user-cap' && r.is_valid === 1,
    );
    expect(valid).toHaveLength(5);
    expect(auditLogCalls).toHaveLength(0); // no eviction yet
  });

  it('evicts oldest sessions sequentially when MAX is exceeded', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 3 });

    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      // Stagger created_at deterministically so ORDER BY created_at ASC is well-defined.
      const session = await createSession('user-evict', `bob${i}`);
      created.push(session.id);
      // Force monotonically-increasing created_at by tweaking the in-memory row.
      const row = sessionStore.get(session.id);
      if (row) {
        row.created_at = `2026-05-05T10:00:0${i}.000Z`;
      }
    }

    const valid = Array.from(sessionStore.values())
      .filter((r) => r.user_id === 'user-evict' && r.is_valid === 1)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    expect(valid).toHaveLength(3);
    // Latest 3 should remain — by id, those are created[2..4]
    const validIds = new Set(valid.map((r) => r.id));
    expect(validIds.has(created[0])).toBe(false);
    expect(validIds.has(created[1])).toBe(false);
    expect(validIds.has(created[2])).toBe(true);
    expect(validIds.has(created[3])).toBe(true);
    expect(validIds.has(created[4])).toBe(true);
  });

  it('does not evict sessions belonging to other users', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 3 });

    // User B logs in once first.
    const userB = await createSession('user-B', 'beth');

    // User A blasts through 5 logins — forcing eviction within user A only.
    for (let i = 0; i < 5; i++) {
      await createSession('user-A', `alice${i}`);
    }

    const userAValid = Array.from(sessionStore.values()).filter(
      (r) => r.user_id === 'user-A' && r.is_valid === 1,
    );
    const userBValid = Array.from(sessionStore.values()).filter(
      (r) => r.user_id === 'user-B' && r.is_valid === 1,
    );

    expect(userAValid).toHaveLength(3);
    expect(userBValid).toHaveLength(1);
    expect(userBValid[0]!.id).toBe(userB.id);
  });

  it('emits a session.evicted audit-log entry with evicted session ids', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 2 });

    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await createSession('user-audit', `c${i}`);
      created.push(s.id);
      // Stagger created_at so the eviction picks the deterministic oldest row.
      const row = sessionStore.get(s.id);
      if (row) row.created_at = `2026-05-05T10:00:0${i}.000Z`;
    }

    // Only the 3rd login should have triggered eviction (1 session evicted).
    expect(auditLogCalls).toHaveLength(1);
    const audit = auditLogCalls[0]!;
    expect(audit.action).toBe('session.evicted');
    expect(audit.user_id).toBe('user-audit');
    expect(audit.target_type).toBe('session');
    expect(audit.target_id).toBe(created[2]); // session that triggered eviction
    const details = audit.details as {
      evicted_session_ids: string[];
      reason: string;
      max_concurrent_sessions: number;
    };
    expect(details.reason).toBe('max_concurrent_sessions_exceeded');
    expect(details.max_concurrent_sessions).toBe(2);
    expect(details.evicted_session_ids).toHaveLength(1);
    // The evicted id should be the FIRST created (oldest by created_at).
    expect(details.evicted_session_ids[0]).toBe(created[0]);
  });

  it('respects different MAX values via configuration', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 1 });

    const a = await createSession('user-config', 'first');
    const b = await createSession('user-config', 'second');

    const valid = Array.from(sessionStore.values()).filter(
      (r) => r.user_id === 'user-config' && r.is_valid === 1,
    );
    expect(valid).toHaveLength(1);
    expect(valid[0]!.id).toBe(b.id);
    expect(sessionStore.has(a.id)).toBe(false);
  });

  /**
   * Regression test for PR #1182 review fix: createSession must serialise
   * concurrent same-user calls via `pg_advisory_xact_lock(hashtext(user_id))`
   * BEFORE running the count → delete → insert sequence. Otherwise the
   * advisory lock provides no mutual exclusion and the race the lock is
   * meant to prevent is reintroduced.
   *
   * Real per-user mutual-exclusion is exercised in
   * session-store.integration.test.ts; this test guards the SQL ordering.
   */
  it(
    'acquires pg_advisory_xact_lock(hashtext(user_id)) before count/delete/insert',
    async () => {
      setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 2 });

      // Pre-seed two sessions for the same user so this createSession will
      // exercise the full count → delete → insert path (eviction triggered).
      sessionStore.set('seed-1', {
        id: 'seed-1',
        user_id: 'user-lock',
        username: 'seed1',
        created_at: '2026-05-05T10:00:00.000Z',
        expires_at: '2099-01-01T00:00:00.000Z',
        last_active: '2026-05-05T10:00:00.000Z',
        is_valid: 1,
      });
      sessionStore.set('seed-2', {
        id: 'seed-2',
        user_id: 'user-lock',
        username: 'seed2',
        created_at: '2026-05-05T10:00:01.000Z',
        expires_at: '2099-01-01T00:00:00.000Z',
        last_active: '2026-05-05T10:00:01.000Z',
        is_valid: 1,
      });

      sqlOpLog.length = 0;
      await createSession('user-lock', 'newcomer');

      // Find the index of each operation kind. The advisory lock must come
      // first; count, delete, and insert must all follow it in that order.
      const kinds = sqlOpLog.map((op) => op.kind);
      const lockIdx = kinds.indexOf('advisory_lock');
      const countIdx = kinds.indexOf('count');
      const deleteIdx = kinds.indexOf('delete');
      const insertIdx = kinds.indexOf('insert');

      expect(lockIdx).toBeGreaterThanOrEqual(0);
      expect(countIdx).toBeGreaterThan(lockIdx);
      expect(deleteIdx).toBeGreaterThan(lockIdx);
      expect(insertIdx).toBeGreaterThan(lockIdx);
      // Sanity: lock-call params include the user_id so per-user isolation works.
      expect(sqlOpLog[lockIdx]!.params).toEqual(['user-lock']);
      // Eviction actually happened (we pre-seeded MAX rows + the new login).
      const valid = Array.from(sessionStore.values()).filter(
        (r) => r.user_id === 'user-lock' && r.is_valid === 1,
      );
      expect(valid).toHaveLength(2);
    },
  );
});
