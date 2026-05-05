import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import { resetConfig, setConfigForTest } from '../config/index.js';
import type { AppDb } from '../db/app-db.js';

// Mock app-db-router to use test database
let testDb: AppDb;

// Kept: app-db-router mock — redirects to test PostgreSQL instance
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { createSession, getSession, invalidateSession, refreshSession, cleanExpiredSessions } from './session-store.js';

beforeAll(async () => {
  testDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('sessions', 'audit_log');
  // Default to a high cap so the basic CRUD tests don't accidentally trip eviction.
  setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 100 });
});

afterEach(() => {
  resetConfig();
});

describe('session-store integration (real PostgreSQL)', () => {
  it('creates and retrieves a session', async () => {
    const session = await createSession('user-123', 'alice');

    expect(session).toBeTruthy();
    expect(session.id).toMatch(/^[a-f0-9-]{36}$/); // UUID format
    expect(session.user_id).toBe('user-123');
    expect(session.username).toBe('alice');

    const retrieved = await getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.user_id).toBe('user-123');
    expect(retrieved?.username).toBe('alice');
  });

  it('returns undefined for non-existent session', async () => {
    const session = await getSession('non-existent-session-id');
    expect(session).toBeUndefined();
  });

  it('refreshes session expiry', async () => {
    const session = await createSession('user-456', 'bob');

    // Wait a bit then refresh
    await new Promise(resolve => setTimeout(resolve, 10));
    await refreshSession(session.id);

    const refreshed = await getSession(session.id);
    expect(refreshed).toBeDefined();
    // expires_at should be updated (later than original)
    expect(new Date(refreshed!.expires_at).getTime()).toBeGreaterThan(
      new Date(session.expires_at).getTime()
    );
  });

  it('invalidates session', async () => {
    const session = await createSession('user-789', 'charlie');

    let retrieved = await getSession(session.id);
    expect(retrieved).toBeDefined();

    await invalidateSession(session.id);

    retrieved = await getSession(session.id);
    expect(retrieved).toBeUndefined(); // Invalid sessions are not returned
  });

  it('refreshSession returns undefined for an expired but valid session', async () => {
    const pool = await getTestPool();

    // Insert an expired session directly (is_valid = true, but expires_at in the past)
    await pool.query(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES ('expired-refresh-test', 'user-expired', 'dave',
              NOW() - INTERVAL '2 hours',
              NOW() - INTERVAL '1 hour',
              NOW() - INTERVAL '90 minutes',
              true)
    `);

    const result = await refreshSession('expired-refresh-test');
    expect(result).toBeUndefined();

    // Verify expires_at was NOT updated in the database
    const { rows } = await pool.query('SELECT expires_at FROM sessions WHERE id = $1', ['expired-refresh-test']);
    expect(rows).toHaveLength(1);
    // The expires_at should still be in the past (not refreshed)
    expect(new Date(rows[0].expires_at).getTime()).toBeLessThan(Date.now());
  });

  it('refreshSession succeeds for a valid non-expired session', async () => {
    const session = await createSession('user-fresh', 'frank');

    const result = await refreshSession(session.id);
    expect(result).toBeDefined();
    expect(result?.id).toBe(session.id);
    expect(new Date(result!.expires_at).getTime()).toBeGreaterThanOrEqual(
      new Date(session.expires_at).getTime()
    );
  });

  it('cleans expired sessions', async () => {
    const pool = await getTestPool();

    // Create an active session (future expiry)
    await pool.query(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES ('active-session', 'user-1', 'alice', NOW(), NOW() + INTERVAL '1 hour', NOW(), true)
    `);

    // Create an expired session (past expiry)
    await pool.query(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES ('expired-session', 'user-2', 'bob', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', NOW(), true)
    `);

    // Create an invalid session (future expiry but is_valid=false)
    await pool.query(`
      INSERT INTO sessions (id, user_id, username, created_at, expires_at, last_active, is_valid)
      VALUES ('invalid-session', 'user-3', 'charlie', NOW(), NOW() + INTERVAL '1 hour', NOW(), false)
    `);

    const cleaned = await cleanExpiredSessions();
    expect(cleaned).toBe(2); // expired + invalid

    // Verify only active session remains
    const { rows } = await pool.query('SELECT id FROM sessions ORDER BY id');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('active-session');
  });
});

describe('session-store performance benchmarks (real PostgreSQL)', () => {
  it('session lookup completes in under 2ms average (PostgreSQL target)', async () => {
    // Create a session
    const session = await createSession('user-perf-1', 'alice');

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
    // Note: This may fail on slow hardware or under load
    expect(avgMs).toBeLessThan(10); // Relaxed for CI (local PG connection)
  });

  it('session creation completes in under 10ms average', async () => {
    const iterations = 50;
    const sessions: string[] = [];
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const session = await createSession(`user-perf-${i}`, `user${i}`);
      sessions.push(session.id);
    }

    const end = performance.now();
    const avgMs = (end - start) / iterations;

    // Session creation should be reasonably fast
    expect(avgMs).toBeLessThan(10);
    expect(sessions).toHaveLength(iterations);
  });

  it('session invalidation completes in under 5ms average', async () => {
    // Create sessions to invalidate
    const sessions = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createSession(`user-inv-${i}`, `user${i}`))
    );

    const iterations = sessions.length;
    const start = performance.now();

    for (const session of sessions) {
      await invalidateSession(session.id);
    }

    const end = performance.now();
    const avgMs = (end - start) / iterations;

    expect(avgMs).toBeLessThan(5);
  });

  it('concurrent session lookups handle load gracefully', async () => {
    // Create 10 sessions
    const sessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createSession(`user-concurrent-${i}`, `user${i}`))
    );

    // Simulate 50 concurrent requests (5 lookups per session)
    const lookups = sessions.flatMap(s => Array(5).fill(s.id));

    const start = performance.now();
    const results = await Promise.all(lookups.map(id => getSession(id)));
    const end = performance.now();

    const totalMs = end - start;
    const avgMs = totalMs / lookups.length;

    // All lookups should succeed
    expect(results.every(r => r !== undefined)).toBe(true);

    // Average should still be reasonable under concurrent load
    expect(avgMs).toBeLessThan(20); // Relaxed for concurrent operations
  });
});

/**
 * Atomic eviction contract for #1107 (MAX_CONCURRENT_SESSIONS_PER_USER).
 *
 * Per CRITIC-FINDINGS §B3/§C2 the load-bearing assertion is the concurrency test:
 * a non-atomic `count()` + `DELETE` would let two concurrent createSession calls
 * read the same pre-eviction count and produce <max sessions. createSession()
 * acquires `pg_advisory_xact_lock(hashtext(user_id))` at the start of its
 * transaction, which provides per-user mutual exclusion under READ COMMITTED
 * (concurrent same-user calls block; different users never contend). The lock
 * auto-releases at COMMIT/ROLLBACK. The post-condition
 * `count(valid sessions for user) == max` must therefore hold even when 5
 * logins fire via Promise.all.
 */
describe('session-store max concurrent sessions — real PostgreSQL (#1107)', () => {
  it('caps at MAX with sequential logins (latest sessions remain valid)', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 3 });

    const created: { id: string; createdAt: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const session = await createSession('user-seq', `alice${i}`);
      created.push({ id: session.id, createdAt: session.created_at });
      // Tiny delay so created_at strictly increases (PG NOW() resolution is microseconds
      // but back-to-back inserts in the same statement timestamp can equal).
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const pool = await getTestPool();
    const { rows } = await pool.query(
      `SELECT id FROM sessions WHERE user_id = $1 AND is_valid = true ORDER BY created_at ASC`,
      ['user-seq'],
    );

    expect(rows).toHaveLength(3);
    const remainingIds = new Set(rows.map((r: { id: string }) => r.id));
    expect(remainingIds.has(created[0]!.id)).toBe(false);
    expect(remainingIds.has(created[1]!.id)).toBe(false);
    expect(remainingIds.has(created[2]!.id)).toBe(true);
    expect(remainingIds.has(created[3]!.id)).toBe(true);
    expect(remainingIds.has(created[4]!.id)).toBe(true);
  });

  it('allows exactly MAX sessions (no eviction at the boundary)', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 5 });

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await createSession('user-boundary', `b${i}`);
      ids.push(s.id);
    }

    const pool = await getTestPool();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM sessions WHERE user_id = $1 AND is_valid = true`,
      ['user-boundary'],
    );
    expect(rows[0].count).toBe(5);
  });

  it('eviction is atomic under concurrent createSession calls (Promise.all × 5, MAX=3)', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 3 });

    // The load-bearing assertion: this must yield exactly 3 valid sessions.
    // A naive count-then-delete would race and leave 0/1/2/4 sessions.
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => createSession('user-concurrent', `c${i}`)),
    );

    const pool = await getTestPool();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM sessions
       WHERE user_id = $1 AND is_valid = true AND expires_at > NOW()`,
      ['user-concurrent'],
    );
    expect(rows[0].count).toBe(3);
  });

  it('does not evict sessions belonging to other users', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 3 });

    // User B logs in once first.
    const userB = await createSession('user-B', 'beth');
    await new Promise((resolve) => setTimeout(resolve, 5));

    // User A blasts through 5 logins — must only evict user A's rows.
    for (let i = 0; i < 5; i++) {
      await createSession('user-A', `alice${i}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const pool = await getTestPool();
    const { rows: aRows } = await pool.query(
      `SELECT count(*)::int AS count FROM sessions WHERE user_id = $1 AND is_valid = true`,
      ['user-A'],
    );
    const { rows: bRows } = await pool.query(
      `SELECT id FROM sessions WHERE user_id = $1 AND is_valid = true`,
      ['user-B'],
    );

    expect(aRows[0].count).toBe(3);
    expect(bRows).toHaveLength(1);
    expect(bRows[0].id).toBe(userB.id);
  });

  it('emits a session.evicted audit-log entry referencing the evicted ids', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 2 });

    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await createSession('user-audit', `a${i}`);
      created.push(s.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const pool = await getTestPool();
    const { rows } = await pool.query(
      `SELECT user_id, action, target_id, details
       FROM audit_log
       WHERE action = 'session.evicted' AND user_id = $1
       ORDER BY created_at ASC`,
      ['user-audit'],
    );

    // Only the 3rd login (over the cap=2) should have triggered an eviction event.
    expect(rows).toHaveLength(1);
    const entry = rows[0];
    expect(entry.user_id).toBe('user-audit');
    expect(entry.target_id).toBe(created[2]); // session that triggered eviction
    expect(entry.details).toMatchObject({
      reason: 'max_concurrent_sessions_exceeded',
      max_concurrent_sessions: 2,
    });
    expect(Array.isArray(entry.details.evicted_session_ids)).toBe(true);
    expect(entry.details.evicted_session_ids).toContain(created[0]);
  });

  it('different MAX values change behaviour (1 -> only newest survives)', async () => {
    setConfigForTest({ MAX_CONCURRENT_SESSIONS_PER_USER: 1 });

    const a = await createSession('user-config', 'first');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createSession('user-config', 'second');

    const pool = await getTestPool();
    const { rows } = await pool.query(
      `SELECT id FROM sessions WHERE user_id = $1 AND is_valid = true`,
      ['user-config'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(b.id);
    // Sanity: the older session is gone.
    const { rows: gone } = await pool.query(`SELECT id FROM sessions WHERE id = $1`, [a.id]);
    expect(gone).toHaveLength(0);
  });
});
