import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { endpointsRoutes } from '../routes/endpoints.js';

// Passthrough mock: keeps real normalizer logic but makes the module writable for spying
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
// Cache mock: bypass caching so each test gets a fresh fetch (prevents cross-test contamination)
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => {
  const real = await importOriginal() as typeof import('@dashboard/core/portainer/portainer-cache.js');
  return {
    ...real,
    cachedFetch: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
    cachedFetchSWR: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  };
});
// Stub the edge live-query boundary so the route test can drive enrichment
// outcomes without a real Portainer tunnel (issue #1249). The settings-store
// is also stubbed so getEffectiveEdgeLiveQueryConfig doesn't try to hit the DB.
vi.mock('@dashboard/core/portainer/edge-live-query.js', () => ({
  fetchEdgeLiveDockerInfo: vi.fn(),
}));
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveEdgeLiveQueryConfig: vi.fn().mockResolvedValue({
    enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000,
  }),
}));

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { fetchEdgeLiveDockerInfo } from '@dashboard/core/portainer/edge-live-query.js';
const mockEdgeFetch = vi.mocked(fetchEdgeLiveDockerInfo);

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

  beforeEach(() => {
    vi.restoreAllMocks();
    mockEdgeFetch.mockReset();
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

    it('returns 502 (not 401) when upstream Portainer returns 401', async () => {
      // Regression: an upstream Portainer auth failure must NOT surface as 401.
      // The frontend api client treats 401 as "session expired" and clears the
      // user's token, which would bounce a logged-in user back to /login
      // whenever PORTAINER_API_KEY is missing or invalid.
      const portainerAuthError = Object.assign(new Error('Auth failed: 401'), {
        name: 'PortainerError',
        kind: 'auth',
        status: 401,
      });
      vi.spyOn(portainerClient, 'getEndpoints').mockRejectedValue(portainerAuthError);

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.error).toMatch(/Portainer/i);
    });

    it('returns 502 when upstream Portainer is unreachable', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(502);
    });

    // Issue #1249 — end-to-end: an Edge Standard endpoint with empty Snapshots[]
    // must surface live counts via the enrichment path, not 0/0/0.
    it('enriches Edge Standard endpoints with empty Snapshots[] via the live fallback', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        {
          Id: 7,
          Name: 'srv-edge-01',
          Type: 4,
          Status: 1,
          Snapshots: [],
          EdgeID: 'edge-abc',
          // Recent check-in keeps the normalizer's heartbeat check happy
          LastCheckInDate: Math.floor(Date.now() / 1000) - 5,
          EdgeCheckinInterval: 5,
        } as any,
      ]);
      mockEdgeFetch.mockResolvedValueOnce({
        containers: 12, containersRunning: 9, containersStopped: 3, fetchedAt: 1_700_000_000_000,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(7);
      expect(body[0].snapshotSource).toBe('live');
      expect(body[0].containersRunning).toBe(9);
      expect(body[0].containersStopped).toBe(3);
      expect(body[0].totalContainers).toBe(12);
      expect(body[0].snapshotFetchedAt).toBe(1_700_000_000_000);
      expect(mockEdgeFetch).toHaveBeenCalledTimes(1);
    });

    it('marks an Edge Standard endpoint as unavailable when live fetch returns null', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        {
          Id: 8, Name: 'srv-edge-broken', Type: 4, Status: 1, Snapshots: [],
          EdgeID: 'edge-broken',
          LastCheckInDate: Math.floor(Date.now() / 1000) - 5,
          EdgeCheckinInterval: 5,
        } as any,
      ]);
      mockEdgeFetch.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body[0].snapshotSource).toBe('unavailable');
      expect(body[0].containersRunning).toBe(0);
      expect(body[0].totalContainers).toBe(0);
    });

    it('does not call the live fetcher for non-Edge endpoints', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        { Id: 1, Name: 'local', Type: 1, Status: 1, Snapshots: [], EdgeID: null } as any,
      ]);

      await app.inject({
        method: 'GET',
        url: '/api/endpoints',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockEdgeFetch).not.toHaveBeenCalled();
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

    it('returns 502 when upstream Portainer fails', async () => {
      vi.spyOn(portainerClient, 'getEndpoint').mockRejectedValue(
        Object.assign(new Error('Auth failed: 401'), {
          name: 'PortainerError',
          kind: 'auth',
          status: 401,
        }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/endpoints/999',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(502);
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
