import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';

// Redirect getDbForDomain to the test database (real PostgreSQL on port 5433).
let testDb: AppDb;
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import {
  createStreamTicket,
  consumeStreamTicket,
  cleanExpiredStreamTickets,
  STREAM_TICKET_TTL_MS,
} from './stream-tickets.js';

beforeAll(async () => {
  testDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('stream_tickets');
});

describe('stream-tickets (real PostgreSQL)', () => {
  it('issues a ticket and writes a row', async () => {
    const issued = await createStreamTicket('user-1', 'alice');

    expect(issued.ticket).toMatch(/^st_[0-9a-f-]{36}_[0-9a-f]{32}$/);
    expect(new Date(issued.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const pool = await getTestPool();
    const { rows } = await pool.query(
      'SELECT id, user_id, username, used_at FROM stream_tickets WHERE id = $1',
      [issued.ticket],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('user-1');
    expect(rows[0].username).toBe('alice');
    expect(rows[0].used_at).toBeNull();
  });

  it('expiresAt is approximately STREAM_TICKET_TTL_MS in the future', async () => {
    const before = Date.now();
    const issued = await createStreamTicket('user-1', 'alice');
    const after = Date.now();

    const expiry = new Date(issued.expiresAt).getTime();
    // Allow some slack for clock skew between Node and PostgreSQL
    expect(expiry).toBeGreaterThanOrEqual(before + STREAM_TICKET_TTL_MS - 1000);
    expect(expiry).toBeLessThanOrEqual(after + STREAM_TICKET_TTL_MS + 1000);
  });

  it('consumes a valid ticket once and returns the user', async () => {
    const issued = await createStreamTicket('user-2', 'bob');

    const result = await consumeStreamTicket(issued.ticket);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-2');
    expect(result?.username).toBe('bob');

    // The row's used_at should now be set
    const pool = await getTestPool();
    const { rows } = await pool.query(
      'SELECT used_at FROM stream_tickets WHERE id = $1',
      [issued.ticket],
    );
    expect(rows[0].used_at).not.toBeNull();
  });

  it('rejects a ticket on the second consume attempt (single-use)', async () => {
    const issued = await createStreamTicket('user-3', 'carol');

    const first = await consumeStreamTicket(issued.ticket);
    expect(first).not.toBeNull();

    const second = await consumeStreamTicket(issued.ticket);
    expect(second).toBeNull();
  });

  it('rejects an expired ticket', async () => {
    const pool = await getTestPool();
    // Insert a ticket whose expires_at is already in the past.
    await pool.query(
      `INSERT INTO stream_tickets (id, user_id, username, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '5 seconds', NULL, NOW() - INTERVAL '60 seconds')`,
      ['st_expired_ticket', 'user-4', 'dave'],
    );

    const result = await consumeStreamTicket('st_expired_ticket');
    expect(result).toBeNull();
  });

  it('rejects an unknown ticket id', async () => {
    const result = await consumeStreamTicket('st_does_not_exist');
    expect(result).toBeNull();
  });

  it('rejects an empty ticket id', async () => {
    const result = await consumeStreamTicket('');
    expect(result).toBeNull();
  });

  it('only one of two concurrent consumes succeeds (race-free)', async () => {
    const issued = await createStreamTicket('user-5', 'erin');

    const [a, b] = await Promise.all([
      consumeStreamTicket(issued.ticket),
      consumeStreamTicket(issued.ticket),
    ]);

    const successes = [a, b].filter((r) => r !== null);
    expect(successes).toHaveLength(1);
    expect(successes[0]?.userId).toBe('user-5');
  });

  it('cleanExpiredStreamTickets purges expired and used rows', async () => {
    const pool = await getTestPool();

    // Active ticket — should remain
    await pool.query(
      `INSERT INTO stream_tickets (id, user_id, username, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 seconds', NULL, NOW())`,
      ['st_active', 'user-1', 'alice'],
    );

    // Expired ticket — should be deleted
    await pool.query(
      `INSERT INTO stream_tickets (id, user_id, username, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '60 seconds', NULL, NOW() - INTERVAL '90 seconds')`,
      ['st_expired', 'user-2', 'bob'],
    );

    // Used (but not expired) ticket — should be deleted
    await pool.query(
      `INSERT INTO stream_tickets (id, user_id, username, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '20 seconds', NOW(), NOW())`,
      ['st_used', 'user-3', 'carol'],
    );

    const deleted = await cleanExpiredStreamTickets();
    expect(deleted).toBe(2);

    const { rows } = await pool.query('SELECT id FROM stream_tickets ORDER BY id');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('st_active');
  });
});
