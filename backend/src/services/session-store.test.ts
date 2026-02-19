import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory store for mock DB
const sessionStore: Map<string, Record<string, unknown>> = new Map();

// Kept: in-memory mock for perf benchmarks; real PG tests in session-store.integration.test.ts
vi.mock('../db/app-db-router.js', () => {
  const mockDb = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO sessions')) {
        const row = {
          id: params[0],
          user_id: params[1],
          username: params[2],
          created_at: params[3],
          expires_at: params[4],
          last_active: params[5],
          is_valid: 1,
        };
        sessionStore.set(row.id as string, row);
        return { changes: 1 };
      }
      if (sql.includes('UPDATE sessions SET expires_at')) {
        // refreshSession
        const expiresAt = params[0];
        const lastActive = params[1];
        const id = params[2] as string;
        const existing = sessionStore.get(id);
        if (existing && existing.is_valid === 1) {
          existing.expires_at = expiresAt;
          existing.last_active = lastActive;
        }
        return { changes: existing ? 1 : 0 };
      }
      if (sql.includes('UPDATE sessions SET is_valid = 0')) {
        const id = params[0] as string;
        const existing = sessionStore.get(id);
        if (existing) existing.is_valid = 0;
        return { changes: existing ? 1 : 0 };
      }
      if (sql.includes('DELETE FROM sessions')) {
        const now = params[0] as string;
        let deleted = 0;
        for (const [id, row] of sessionStore) {
          if ((row.expires_at as string) < now || row.is_valid === 0) {
            sessionStore.delete(id);
            deleted++;
          }
        }
        return { changes: deleted };
      }
      return { changes: 0 };
    }),
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM sessions WHERE id')) {
        const id = params[0] as string;
        const now = params[1] as string;
        const row = sessionStore.get(id);
        if (row && row.is_valid === 1 && (row.expires_at as string) > now) {
          return row;
        }
        return null;
      }
      return null;
    }),
    query: vi.fn(async () => []),
  };
  return { getDbForDomain: vi.fn(() => mockDb) };
});

import { createSession, getSession, invalidateSession, refreshSession, cleanExpiredSessions } from './session-store.js';

describe('session-store performance benchmarks', () => {
  beforeEach(() => {
    sessionStore.clear();
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
  });

  afterEach(() => {
    vi.useRealTimers();
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
