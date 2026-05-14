import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { tracesRoutes } from '../routes/traces.js';

let appDb: AppDb;
let spanCounter = 0;

async function insertSpan(opts: {
  service: string;
  duration: number;
  startTime: string;
  status: 'ok' | 'error';
  containerName?: string | null;
}) {
  spanCounter += 1;
  await appDb.execute(
    `INSERT INTO spans (
       id, trace_id, parent_span_id, name, kind, status,
       start_time, end_time, duration_ms, service_name, attributes,
       container_name, created_at
     ) VALUES (?, ?, NULL, ?, 'server', ?, ?, ?, ?, ?, '{}', ?, NOW())`,
    [
      `r-${spanCounter}`,
      `t-${spanCounter}`,
      'op',
      opts.status,
      opts.startTime,
      opts.startTime,
      opts.duration,
      opts.service,
      opts.containerName ?? null,
    ],
  );
}

beforeAll(async () => {
  appDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('spans');
  spanCounter = 0;
});

describe('GET /api/traces/red', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    await app.register(async (instance) => {
      instance.decorate('authenticate', async () => undefined);
      instance.decorate('requireRole', () => async () => undefined);
      await tracesRoutes(instance);
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('400 on missing from/to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/traces/red',
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns RED rows for the seeded span set', async () => {
    const now = '2026-05-14T12:00:00.000Z';
    for (let i = 1; i <= 50; i++) {
      await insertSpan({ service: 'api', duration: i, startTime: now, status: 'ok' });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces/red?from=2026-05-14T11:00:00.000Z&to=2026-05-14T13:00:00.000Z&bucket=1h&groupBy=service`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      truncated: boolean;
      buckets: Array<{ bucketStart: string; rows: Array<{ group: string; callCount: number }> }>;
    };
    expect(body.truncated).toBe(false);
    const allRows = body.buckets.flatMap((b) => b.rows);
    expect(allRows.find((r) => r.group === 'api')!.callCount).toBe(50);
  });

  it('rejects invalid bucket enum', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces/red?from=2026-05-14T11:00:00.000Z&to=2026-05-14T13:00:00.000Z&bucket=2m&groupBy=service`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(400);
  });
});

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));
