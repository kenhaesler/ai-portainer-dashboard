import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { endpointsRoutes } from '../routes/endpoints.js';

// Passthrough mock: keeps real normalizer logic but makes the module writable for spying
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => await importOriginal());

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import * as portainerCache from '@dashboard/core/portainer/portainer-cache.js';

const fakeEndpoint = (id: number, name: string, type = 1, status = 1) => ({
  Id: id,
  Name: name,
  Type: type,
  Status: status,
  Snapshots: [],
  EdgeID: null,
  LastCheckInDate: null,
  EdgeCheckinInterval: null,
});

describe('Endpoints Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(endpointsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Clear the in-memory cache between tests to prevent cross-test leakage
    // (cachedFetch stores results in the HybridCache singleton)
    await portainerCache.cache.clear();
  });

  describe('GET /api/endpoints', () => {
    it('returns normalized endpoint list', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeEndpoint(1, 'prod'),
        fakeEndpoint(2, 'staging'),
      ] as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(2);
      expect(body[0]).toHaveProperty('id');
      expect(body[0]).toHaveProperty('name');
      expect(body[0]).toHaveProperty('status');
    });

    it('returns empty array when no endpoints', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual([]);
    });

    it('requires authentication', async () => {
      const unauthApp = Fastify({ logger: false });
      unauthApp.setValidatorCompiler(validatorCompiler);
      // authenticate throws to simulate real auth check
      unauthApp.decorate('authenticate', async (_req: any, reply: any) => {
        reply.code(401).send({ error: 'Unauthorized' });
      });
      unauthApp.decorate('requireRole', () => async () => undefined);
      await unauthApp.register(endpointsRoutes);
      await unauthApp.ready();

      const response = await unauthApp.inject({
        method: 'GET',
        url: '/api/endpoints',
      });

      expect(response.statusCode).toBe(401);
      await unauthApp.close();
    });
  });

  describe('GET /api/endpoints/:id', () => {
    it('returns a single endpoint by id', async () => {
      vi.spyOn(portainerClient, 'getEndpoint').mockResolvedValue(
        fakeEndpoint(1, 'prod') as any,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints/1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(1);
      expect(body.name).toBe('prod');
    });

    it('propagates errors from portainer client', async () => {
      vi.spyOn(portainerClient, 'getEndpoint').mockRejectedValue(
        Object.assign(new Error('Not Found'), { statusCode: 404 }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints/999',
        headers: { authorization: 'Bearer test' },
      });

      // Fastify propagates the error; exact status depends on error type
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /api/endpoints/debug/edge-status', () => {
    it('returns raw edge endpoint data', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeEndpoint(1, 'edge-node', 4, 1), // type 4 = edge async
      ] as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints/debug/edge-status',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0]).toHaveProperty('id');
      expect(body[0]).toHaveProperty('normalizedStatus');
      expect(body[0]).toHaveProperty('nowUnix');
    });
  });
});
