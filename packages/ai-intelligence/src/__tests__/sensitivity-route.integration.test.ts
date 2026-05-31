/**
 * Integration test — per-user Sensitivity preset (issue #1297, AC).
 *
 * Validates against a real PostgreSQL instance that:
 *   1. GET /api/monitoring/sensitivity returns 'default' when unset.
 *   2. PUT /api/monitoring/sensitivity persists per user — User A and User B
 *      can hold different presets.
 *   3. Two users with different presets querying GET /api/monitoring/insights
 *      against the SAME underlying anomaly set receive different visible
 *      counts.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

// Redirect production db lookups to the test instance — same pattern as
// other route integration tests in this package.
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

async function buildApp(currentUserId: () => string) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  app.decorateRequest('user', undefined);
  app.addHook('preHandler', async (request) => {
    request.user = {
      sub: currentUserId(),
      username: currentUserId(),
      sessionId: `s-${currentUserId()}`,
      role: 'viewer' as const,
    };
  });
  await app.register(monitoringRoutes, monitoringOpts);
  await app.ready();
  return app;
}

let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  testDb = await getTestDb();
  // Seed two test users so user_settings' FK references resolve. Defensively
  // delete any leftover rows from a previous interrupted run — the original
  // `ON CONFLICT (id) DO NOTHING` only covered the id constraint, but the
  // `users.username` unique constraint can still trip if a row was left
  // behind under a different id (or if afterAll did not run cleanly).
  const pool = await getTestPool();
  await pool.query(
    "DELETE FROM users WHERE id IN ('u-alice', 'u-bob') OR username IN ('alice', 'bob')",
  );
  await pool.query(`
    INSERT INTO users (id, username, password_hash, role)
    VALUES ('u-alice', 'alice', 'x', 'viewer'), ('u-bob', 'bob', 'x', 'viewer')
  `);
  app = await buildApp(() => userId);
});

afterAll(async () => {
  await app.close();
  // Clean up seed users to keep the shared test DB tidy.
  const pool = await getTestPool();
  await pool.query("DELETE FROM users WHERE id IN ('u-alice', 'u-bob')");
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('insights', 'user_settings');
});

describe('GET /api/monitoring/sensitivity', () => {
  it("returns 'default' when the user has never saved a preset", async () => {
    userId = 'u-alice';
    const res = await app.inject({
      method: 'GET',
      url: '/api/monitoring/sensitivity',
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ preset: 'default' });
  });

  it('returns the saved preset for the calling user', async () => {
    userId = 'u-alice';
    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      payload: { preset: 'high' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/monitoring/sensitivity',
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ preset: 'high' });
  });

  it('isolates presets per user', async () => {
    userId = 'u-alice';
    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'high' },
      headers: { 'content-type': 'application/json' },
    });

    userId = 'u-bob';
    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'low' },
      headers: { 'content-type': 'application/json' },
    });

    userId = 'u-alice';
    expect((await app.inject({ method: 'GET', url: '/api/monitoring/sensitivity' })).json())
      .toEqual({ preset: 'high' });

    userId = 'u-bob';
    expect((await app.inject({ method: 'GET', url: '/api/monitoring/sensitivity' })).json())
      .toEqual({ preset: 'low' });
  });
});

describe('PUT /api/monitoring/sensitivity', () => {
  it('rejects an unknown preset with 400', async () => {
    userId = 'u-alice';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'extreme' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing body with 400', async () => {
    userId = 'u-alice';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns the saved preset on success', async () => {
    userId = 'u-alice';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'low' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ preset: 'low' });
  });
});

describe('GET /api/monitoring/insights — per-user Sensitivity post-filter', () => {
  // Seed a small set of insights spanning the threshold range. Under default
  // env config (ANOMALY_ZSCORE_THRESHOLD = 3.5), the three presets each
  // produce a distinct visible count:
  //   Low      threshold = 4.55 → only z=5.0 passes
  //   Default  threshold = 3.5  → z=3.6, 4.6, 5.0 pass
  //   High     threshold ≈ 2.975 → z=3.0, 3.6, 4.6, 5.0 pass
  async function seedFiveAnomalies(): Promise<void> {
    const rows = [2.5, 3.0, 3.6, 4.6, 5.0].map((z, idx) => ({
      id: `a-${idx}`,
      severity: 'warning',
      category: 'anomaly',
      title: `anomaly ${idx}`,
      description: `cpu spike (mean: 40.0%, z-score: ${z.toFixed(2)})`,
      suggested_action: null,
      z_score: z,
    }));

    for (const row of rows) {
      await testDb.execute(
        `INSERT INTO insights (
          id, endpoint_id, endpoint_name, container_id, container_name,
          severity, category, title, description, suggested_action,
          is_acknowledged, created_at, z_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW(), ?)`,
        [row.id, 1, 'local', 'c1', 'web', row.severity, row.category, row.title, row.description, row.suggested_action, row.z_score],
      );
    }
  }

  it('two users with different presets get different visible counts on the same data', async () => {
    await seedFiveAnomalies();

    // User Alice → Low (strict)
    userId = 'u-alice';
    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'low' },
      headers: { 'content-type': 'application/json' },
    });
    const aliceRes = await app.inject({ method: 'GET', url: '/api/monitoring/insights' });
    expect(aliceRes.statusCode).toBe(200);
    const aliceBody = aliceRes.json();
    expect(aliceBody.sensitivity).toBe('low');

    // User Bob → High (loose)
    userId = 'u-bob';
    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'high' },
      headers: { 'content-type': 'application/json' },
    });
    const bobRes = await app.inject({ method: 'GET', url: '/api/monitoring/insights' });
    expect(bobRes.statusCode).toBe(200);
    const bobBody = bobRes.json();
    expect(bobBody.sensitivity).toBe('high');

    // visibleTotal is the post-filter count for the page; the DB-side total
    // is identical for both users.
    expect(bobBody.visibleTotal).toBeGreaterThan(aliceBody.visibleTotal);
    expect(bobBody.total).toBe(aliceBody.total); // same underlying data
    expect(aliceBody.visibleTotal).toBeLessThanOrEqual(2);
    expect(bobBody.visibleTotal).toBeGreaterThanOrEqual(3);
  });

  it('defaults to "default" preset when the user has no saved setting', async () => {
    await seedFiveAnomalies();

    userId = 'u-alice';
    const res = await app.inject({ method: 'GET', url: '/api/monitoring/insights' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sensitivity).toBe('default');
  });

  it('non-anomaly insights without a z-score pass through regardless of preset', async () => {
    // Predictive forecast: no z-score in description.
    await testDb.execute(
      `INSERT INTO insights (
        id, endpoint_id, endpoint_name, container_id, container_name,
        severity, category, title, description, suggested_action,
        is_acknowledged, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NOW())`,
      ['p1', 1, 'local', 'c1', 'web', 'warning', 'predictive', 'Memory exhaustion in ~6h',
        'Forecast indicates memory threshold breach in approximately 6h', null],
    );

    userId = 'u-alice';
    // Even under Low (strictest), the predictive insight passes through.
    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'low' },
      headers: { 'content-type': 'application/json' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/monitoring/insights' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.visibleTotal).toBe(1);
    expect(body.insights[0].id).toBe('p1');
  });
});
