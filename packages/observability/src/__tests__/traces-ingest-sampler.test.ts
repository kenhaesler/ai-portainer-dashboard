/**
 * Integration test: sampler wired into the OTLP ingest path + admin-only
 * /api/traces/ingest-stats endpoint.
 *
 * Uses real Postgres (truncateTestTables('spans')) and a real Fastify
 * instance composed the same way other observability route tests build theirs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { tracesIngestRoutes, __resetSamplerForTests } from '../routes/traces-ingest.js';
import { tracesRoutes } from '../routes/traces.js';

let appDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));

// Route imports getConfig() to construct the sampler. Stub it to a permissive
// "reject all" config for the first test and a "no-op" config for admin-role
// check (admin/non-admin separation comes from the test app's auth decorator).
let configOverride: Record<string, unknown> = {};
vi.mock('@dashboard/core/config/index.js', async (orig) => {
  const real = (await orig()) as { getConfig: () => Record<string, unknown> };
  return {
    ...real,
    getConfig: () => ({
      ...real.getConfig(),
      ...configOverride,
    }),
  };
});

beforeAll(async () => {
  appDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('spans');
  __resetSamplerForTests();
});

function buildApp(opts: { isAdmin: boolean }): Promise<FastifyInstance> {
  return (async () => {
    const app = Fastify({ logger: false });
    // Trace ingest is body-parsed; default JSON parser is fine.
    app.decorate('authenticate', async (req: FastifyRequest) => {
      // Stamp a user object so requireRole can see a role.
      (req as unknown as { user?: { role: string } }).user = {
        role: opts.isAdmin ? 'admin' : 'user',
      };
    });
    app.decorate('requireRole', (minRole: string) => async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
      const role = (req as unknown as { user?: { role?: string } }).user?.role;
      if (minRole === 'admin' && role !== 'admin') {
        return reply.status(403).send({ error: 'forbidden' });
      }
    });
    await app.register(async (instance) => {
      instance.decorate('authenticate', app.authenticate);
      instance.decorate('requireRole', app.requireRole);
      await tracesIngestRoutes(instance);
      await tracesRoutes(instance);
    });
    await app.ready();
    return app;
  })();
}

describe('ingest sampler integration', () => {
  it('rejects all spans when sampleRate=0 and increments droppedTotal', async () => {
    configOverride = {
      TRACES_INGESTION_ENABLED: true,
      TRACES_INGESTION_API_KEY: 'k',
      TRACES_SAMPLE_RATE: 0,
      TRACES_INGEST_MAX_SPANS_PER_SEC: 0,
    };
    const app = await buildApp({ isAdmin: true });
    try {
      const otlp = {
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'a' } }] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'AA'.repeat(16),
                    spanId: 'BB'.repeat(8),
                    name: 'op',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '2000000000',
                    kind: 1,
                  },
                ],
              },
            ],
          },
        ],
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/traces/otlp',
        headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
        payload: otlp,
      });
      expect(res.statusCode).toBe(200);

      const pool = await getTestPool();
      const { rows } = await pool.query<{ c: string }>('SELECT count(*)::text as c FROM spans');
      expect(Number(rows[0].c)).toBe(0);

      const stats = await app.inject({
        method: 'GET',
        url: '/api/traces/ingest-stats',
        headers: { authorization: 'Bearer admin' },
      });
      expect(stats.statusCode).toBe(200);
      const body = stats.json() as { droppedTotal: number };
      expect(body.droppedTotal).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('ingest-stats requires admin role', async () => {
    configOverride = {
      TRACES_INGESTION_ENABLED: true,
      TRACES_INGESTION_API_KEY: 'k',
      TRACES_SAMPLE_RATE: 1.0,
      TRACES_INGEST_MAX_SPANS_PER_SEC: 0,
    };
    const app = await buildApp({ isAdmin: false });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/traces/ingest-stats',
        headers: { authorization: 'Bearer user' },
      });
      expect([401, 403]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });
});
