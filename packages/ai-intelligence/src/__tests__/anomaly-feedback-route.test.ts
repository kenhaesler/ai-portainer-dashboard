/**
 * DB-backed integration test for the anomaly-feedback routes (#1298).
 *
 * Uses a real PostgreSQL test database (port 5433 by default — see
 * docker/docker-compose.dev.yml). The test redirects getDbForDomain
 * to the test pool so the route's INSERT/SELECT exercise the real
 * UNIQUE (anomaly_id, user_id) constraint and the ON CONFLICT
 * DO NOTHING idempotency contract.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { randomUUID } from 'crypto';

let testDb: AppDb;

// Redirect getDbForDomain (used by monitoringRoutes) to the test database.
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { monitoringRoutes, type MonitoringRoutesOpts } from '../routes/monitoring.js';

const monitoringOpts: MonitoringRoutesOpts = {
  getSecurityAudit: vi.fn().mockResolvedValue([]),
  getSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
  setSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
  defaultSecurityAuditIgnorePatterns: [],
  securityAuditIgnoreKey: 'test-ignore-key',
};

interface TestUser {
  sub: string;
  username: string;
  role: 'viewer' | 'operator' | 'admin';
  sessionId: string;
}

function buildApp(currentUser: { value: TestUser }): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  app.decorateRequest('user', undefined);
  app.addHook('preHandler', async (request) => {
    request.user = currentUser.value;
  });
  return app;
}

async function seedUser(id: string, username: string, role: 'viewer' | 'operator' | 'admin'): Promise<void> {
  await testDb.execute(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, username, 'hash', role],
  );
}

async function seedInsight(
  id: string,
  opts: { category?: string; detection_method?: string | null; container_id?: string } = {},
): Promise<void> {
  await testDb.execute(
    `INSERT INTO insights (id, severity, category, title, description, container_id, detection_method)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      'warning',
      opts.category ?? 'anomaly',
      'test insight',
      'desc',
      opts.container_id ?? 'c1',
      opts.detection_method ?? 'threshold',
    ],
  );
}

describe('anomaly-feedback routes (#1298)', () => {
  let app: FastifyInstance;
  const currentUser: { value: TestUser } = {
    value: {
      sub: 'user-a',
      username: 'alice',
      role: 'operator',
      sessionId: 's1',
    },
  };

  beforeAll(async () => {
    testDb = await getTestDb();
    app = buildApp(currentUser);
    await app.register(monitoringRoutes, monitoringOpts);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    // CASCADE drops anomaly_feedback rows referencing these insights/users.
    await truncateTestTables('anomaly_feedback', 'insights', 'users');
    await seedUser('user-a', 'alice', 'operator');
    await seedUser('user-b', 'bob', 'operator');
    await seedUser('user-admin', 'admin', 'admin');
    currentUser.value = {
      sub: 'user-a',
      username: 'alice',
      role: 'operator',
      sessionId: 's1',
    };
  });

  // ── POST /api/monitoring/anomaly-feedback ──────────────────────

  describe('POST /api/monitoring/anomaly-feedback', () => {
    it('records a feedback row on first submission', async () => {
      const anomalyId = randomUUID();
      await seedInsight(anomalyId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.anomalyId).toBe(anomalyId);
      expect(body.disposition).toBe('false-positive');
      expect(body.duplicate).toBe(false);

      const pool = await getTestPool();
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM anomaly_feedback
         WHERE anomaly_id = $1 AND user_id = $2`,
        [anomalyId, 'user-a'],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('is idempotent: resubmitting the same (anomaly, user) returns 200 and inserts no duplicate', async () => {
      const anomalyId = randomUUID();
      await seedInsight(anomalyId);

      // First insertion — must report duplicate=false.
      const first = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId },
        headers: { 'content-type': 'application/json' },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().duplicate).toBe(false);

      // Second insertion — the UPSERT RETURNING contract reports
      // duplicate=true the moment ON CONFLICT fires, regardless of
      // wall-clock skew or how fast the two calls fired.
      const second = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId },
        headers: { 'content-type': 'application/json' },
      });

      expect(second.statusCode).toBe(200);
      expect(second.json().success).toBe(true);
      expect(second.json().duplicate).toBe(true);

      // Still only one row.
      const pool = await getTestPool();
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM anomaly_feedback
         WHERE anomaly_id = $1 AND user_id = $2`,
        [anomalyId, 'user-a'],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('multi-user: two users marking the same anomaly produces two rows, not one', async () => {
      const anomalyId = randomUUID();
      await seedInsight(anomalyId);

      // Alice submits.
      currentUser.value = {
        sub: 'user-a',
        username: 'alice',
        role: 'operator',
        sessionId: 's1',
      };
      const aliceRes = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId },
        headers: { 'content-type': 'application/json' },
      });
      expect(aliceRes.statusCode).toBe(200);

      // Bob submits.
      currentUser.value = {
        sub: 'user-b',
        username: 'bob',
        role: 'operator',
        sessionId: 's2',
      };
      const bobRes = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId },
        headers: { 'content-type': 'application/json' },
      });
      expect(bobRes.statusCode).toBe(200);

      const pool = await getTestPool();
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM anomaly_feedback
         WHERE anomaly_id = $1`,
        [anomalyId],
      );
      expect(Number(rows[0].count)).toBe(2);
    });

    it('rejects when anomalyId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: {},
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown detector value (allowlist enforced via Zod enum)', async () => {
      const anomalyId = randomUUID();
      await seedInsight(anomalyId);

      // The detector field is constrained to ANOMALY_DETECTORS (the shared
      // allowlist from @dashboard/core/models/monitoring.ts).
      // An attacker-controlled label like '<script>' or 'totally-fake-detector'
      // must be rejected at the API boundary so it never reaches the
      // rate breakdown.
      const res = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId, detector: 'totally-fake-detector' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepts a known detector value from the allowlist', async () => {
      const anomalyId = `correlated:c-${randomUUID()}:2026-01-01T00:00:00Z`;
      // No insight row — this is the correlated-anomaly path.

      const res = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId, detector: 'correlated-zscore' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().duplicate).toBe(false);

      const pool = await getTestPool();
      const { rows } = await pool.query<{ detector: string }>(
        `SELECT detector FROM anomaly_feedback WHERE anomaly_id = $1`,
        [anomalyId],
      );
      expect(rows[0].detector).toBe('correlated-zscore');
    });
  });

  // ── GET /api/monitoring/anomaly-feedback/rates ─────────────────

  describe('GET /api/monitoring/anomaly-feedback/rates', () => {
    it('returns rate=0 for a detector with no feedback', async () => {
      const id1 = randomUUID();
      await seedInsight(id1, { detection_method: 'threshold' });

      // Force admin so we query fleet-wide.
      currentUser.value = {
        sub: 'user-admin',
        username: 'admin',
        role: 'admin',
        sessionId: 's3',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const threshold = body.rates.find((r: { detector: string }) => r.detector === 'threshold');
      expect(threshold).toBeDefined();
      expect(threshold.anomalies).toBe(1);
      expect(threshold.falsePositives).toBe(0);
      expect(threshold.rate).toBe(0);
    });

    it('returns rate=1 when every anomaly has feedback (fleet-wide, admin)', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await seedInsight(id1, { detection_method: 'ml-anomaly' });
      await seedInsight(id2, { detection_method: 'ml-anomaly' });

      // Alice marks both.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?), (?, ?, ?)`,
        [id1, 'user-a', 'false-positive', id2, 'user-a', 'false-positive'],
      );

      currentUser.value = {
        sub: 'user-admin',
        username: 'admin',
        role: 'admin',
        sessionId: 's3',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.scope).toBe('fleet');
      const ml = body.rates.find((r: { detector: string }) => r.detector === 'ml-anomaly');
      expect(ml).toBeDefined();
      expect(ml.anomalies).toBe(2);
      expect(ml.falsePositives).toBe(2);
      expect(ml.rate).toBe(1);
    });

    it('returns mixed rates per detector', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();
      const id4 = randomUUID();
      await seedInsight(id1, { detection_method: 'isolation-forest' });
      await seedInsight(id2, { detection_method: 'isolation-forest' });
      await seedInsight(id3, { detection_method: 'isolation-forest' });
      await seedInsight(id4, { detection_method: 'isolation-forest' });

      // 1/4 marked → 0.25
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?)`,
        [id1, 'user-a', 'false-positive'],
      );

      currentUser.value = {
        sub: 'user-admin',
        username: 'admin',
        role: 'admin',
        sessionId: 's3',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });

      const body = res.json();
      const iso = body.rates.find((r: { detector: string }) => r.detector === 'isolation-forest');
      expect(iso).toBeDefined();
      expect(iso.anomalies).toBe(4);
      expect(iso.falsePositives).toBe(1);
      expect(iso.rate).toBeCloseTo(0.25, 4);
    });

    it('caller scope: non-admin only sees their own feedback in the rate', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await seedInsight(id1, { detection_method: 'threshold' });
      await seedInsight(id2, { detection_method: 'threshold' });

      // Bob marks both anomalies — should NOT count toward Alice's rate.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?), (?, ?, ?)`,
        [id1, 'user-b', 'false-positive', id2, 'user-b', 'false-positive'],
      );

      // Alice marks only one.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?)`,
        [id1, 'user-a', 'false-positive'],
      );

      currentUser.value = {
        sub: 'user-a',
        username: 'alice',
        role: 'operator',
        sessionId: 's1',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.scope).toBe('mine');
      const t = body.rates.find((r: { detector: string }) => r.detector === 'threshold');
      // Alice only marked 1 out of 2 anomalies → rate = 0.5
      expect(t.anomalies).toBe(2);
      expect(t.falsePositives).toBe(1);
      expect(t.rate).toBeCloseTo(0.5, 4);
    });

    it('admin scope-widening: admin sees fleet-wide rate by default', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await seedInsight(id1, { detection_method: 'threshold' });
      await seedInsight(id2, { detection_method: 'threshold' });

      // Two different users mark different anomalies.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?), (?, ?, ?)`,
        [id1, 'user-a', 'false-positive', id2, 'user-b', 'false-positive'],
      );

      currentUser.value = {
        sub: 'user-admin',
        username: 'admin',
        role: 'admin',
        sessionId: 's3',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });

      const body = res.json();
      expect(body.scope).toBe('fleet');
      const t = body.rates.find((r: { detector: string }) => r.detector === 'threshold');
      // Fleet-wide: 2 anomalies, 2 false positives across both users.
      expect(t.anomalies).toBe(2);
      expect(t.falsePositives).toBe(2);
      expect(t.rate).toBe(1);
    });

    it('admin can opt into caller scope via ?scope=mine', async () => {
      const id1 = randomUUID();
      await seedInsight(id1, { detection_method: 'threshold' });

      // Another user marked it, admin did not.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?)`,
        [id1, 'user-a', 'false-positive'],
      );

      currentUser.value = {
        sub: 'user-admin',
        username: 'admin',
        role: 'admin',
        sessionId: 's3',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates?scope=mine',
      });

      const body = res.json();
      expect(body.scope).toBe('mine');
      const t = body.rates.find((r: { detector: string }) => r.detector === 'threshold');
      // Admin has no feedback of their own → rate = 0.
      expect(t.anomalies).toBe(1);
      expect(t.falsePositives).toBe(0);
      expect(t.rate).toBe(0);
    });

    it('non-admin cannot widen scope to fleet (?scope=fleet is forced to "mine")', async () => {
      const id1 = randomUUID();
      await seedInsight(id1, { detection_method: 'threshold' });

      // Bob (other user) marks it.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition)
         VALUES (?, ?, ?)`,
        [id1, 'user-b', 'false-positive'],
      );

      currentUser.value = {
        sub: 'user-a',
        username: 'alice',
        role: 'operator',
        sessionId: 's1',
      };

      // Alice tries to widen scope. The privacy contract requires that
      // non-admins always get caller-scoped data regardless of `scope`.
      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates?scope=fleet',
      });

      const body = res.json();
      expect(body.scope).toBe('mine');
      const t = body.rates.find((r: { detector: string }) => r.detector === 'threshold');
      // Alice has zero feedback; Bob's row must not leak through.
      expect(t.anomalies).toBe(1);
      expect(t.falsePositives).toBe(0);
    });

    it('correlated-branch fleet rate: distinct denominator, per-vote numerator, clamped to 1', async () => {
      // Two correlated anomaly IDs (no matching insights row), only one
      // is flagged — and by two users. With the old query the rate was
      // trivially 1.0 (denominator = numerator = COUNT(DISTINCT)); with
      // the fix the denominator is "unique correlated anomalies that
      // received feedback" and the numerator is "total votes", so the
      // raw ratio is 2/1 = 2.0. The JS layer then clamps to 1.0 so the
      // UI badge doesn't render 200%.
      const correlatedId1 = `correlated:c1:${new Date().toISOString()}`;
      const correlatedId2 = `correlated:c2:${new Date().toISOString()}`;

      // user-a marks correlated #1.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition, detector)
         VALUES (?, ?, ?, ?)`,
        [correlatedId1, 'user-a', 'false-positive', 'correlated-zscore'],
      );
      // user-b marks the *same* correlated #1.
      await testDb.execute(
        `INSERT INTO anomaly_feedback (anomaly_id, user_id, disposition, detector)
         VALUES (?, ?, ?, ?)`,
        [correlatedId1, 'user-b', 'false-positive', 'correlated-zscore'],
      );
      // Note correlated #2 (correlatedId2) receives no feedback — the
      // current schema has no way to know it exists server-side, which
      // is exactly why the correlated denominator can never be a true
      // "all surfaced anomalies" count.
      void correlatedId2;

      currentUser.value = {
        sub: 'user-admin',
        username: 'admin',
        role: 'admin',
        sessionId: 's3',
      };

      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const corr = body.rates.find(
        (r: { detector: string }) => r.detector === 'correlated-zscore',
      );
      expect(corr).toBeDefined();
      // 1 unique correlated anomaly received feedback.
      expect(corr.anomalies).toBe(1);
      // 2 votes (user-a + user-b).
      expect(corr.falsePositives).toBe(2);
      // Raw ratio 2/1 clamped to 1.0 — the badge is non-trivial and
      // bounded, where the previous COUNT(DISTINCT)/COUNT(DISTINCT)
      // formulation would have returned exactly 1.0 even if zero users
      // had flagged the anomaly (because numerator == denominator by
      // construction).
      expect(corr.rate).toBe(1);
    });
  });
});
