/**
 * Route test for /api/dedup-telemetry — verifies the admin RBAC gate and
 * the basic shape of the response. The DB layer is mocked here; the
 * integration shape is covered by dedup-telemetry.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

const mockQuery = vi.fn();

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
    queryOne: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
    healthCheck: vi.fn(async () => true),
  }),
}));

import { dedupTelemetryRoutes } from '../routes/dedup-telemetry.js';

function buildApp(role: 'viewer' | 'admin'): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
  app.decorateRequest('user', undefined);
  app.addHook('preHandler', async (request) => {
    request.user = { sub: 'u1', username: 'u1', sessionId: 's1', role };
  });
  return app;
}

describe('GET /api/dedup-telemetry', () => {
  let adminApp: FastifyInstance;
  let viewerApp: FastifyInstance;

  beforeAll(async () => {
    adminApp = buildApp('admin');
    await adminApp.register(dedupTelemetryRoutes);
    await adminApp.ready();
    viewerApp = buildApp('viewer');
    await viewerApp.register(dedupTelemetryRoutes);
    await viewerApp.ready();
  });

  afterAll(async () => {
    await adminApp.close();
    await viewerApp.close();
    mockQuery.mockReset();
  });

  it('returns the latest metric rows for an admin', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        collected_at: '2026-05-16T18:00:00Z',
        window_hours: 168,
        signature: 'anomaly:threshold:cpu',
        total_insights: 144,
        distinct_containers: 8,
        alerts_per_container: 18,
        total_incidents: 5,
        avg_insights_per_incident: 18,
      },
    ]);

    const res = await adminApp.inject({ method: 'GET', url: '/api/dedup-telemetry' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ signature: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].signature).toBe('anomaly:threshold:cpu');
  });

  it('honours the signature query param', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await adminApp.inject({
      method: 'GET',
      url: '/api/dedup-telemetry?signature=anomaly:threshold:cpu',
    });
    expect(res.statusCode).toBe(200);
    // The mock was called with the signature filter and a default limit.
    const lastCall = mockQuery.mock.calls.at(-1)!;
    expect(lastCall[1]).toContain('anomaly:threshold:cpu');
  });

  it('rejects viewer-role callers with 403', async () => {
    const res = await viewerApp.inject({ method: 'GET', url: '/api/dedup-telemetry' });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 on invalid limit', async () => {
    const res = await adminApp.inject({
      method: 'GET',
      url: '/api/dedup-telemetry?limit=99999',
    });
    expect(res.statusCode).toBe(400);
  });
});
