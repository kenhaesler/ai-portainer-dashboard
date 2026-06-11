import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { testAdminOnly } from '@dashboard/core/test-utils/rbac-test-helper.js';
import { incidentsRoutes } from '../routes/incidents.js';
import { getIncidents, getIncident, resolveIncident, getIncidentCount, resolveIncidentsBatch, getIncidentGroups } from '../services/incident-store.js';

// Mock the stores — all functions are now async
// Kept: incident-store mock — no PostgreSQL in CI
vi.mock('../services/incident-store.js', () => ({
  getIncidents: vi.fn(() => Promise.resolve([])),
  getIncident: vi.fn(() => Promise.resolve(null)),
  resolveIncident: vi.fn(() => Promise.resolve()),
  getIncidentCount: vi.fn(() => Promise.resolve({ active: 0, resolved: 0, total: 0 })),
  resolveIncidentsBatch: vi.fn(() => Promise.resolve({ resolved: [], failed: [] })),
  getIncidentGroups: vi.fn(() => Promise.resolve({ groups: [], endpoint_facets: [], total_active: 0 })),
}));

// Kept: app-db-router mock — tests control database routing
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: vi.fn(() => ({
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn(),
    transaction: vi.fn((fn: (db: unknown) => unknown) => fn({ query: vi.fn(), queryOne: vi.fn(), execute: vi.fn() })),
  })),
}));

// Kept: portainer-cache mock — cachedFetchSWR passes through to fetcher in tests
vi.mock('@dashboard/core/portainer/portainer-cache.js', () => ({
  cachedFetchSWR: vi.fn((_key: string, _ttl: number, fetcher: () => unknown) => fetcher()),
  getCacheKey: vi.fn((...parts: unknown[]) => parts.join(':')),
  cache: { invalidatePattern: vi.fn(() => Promise.resolve()) },
}));

const mockedGetIncidents = vi.mocked(getIncidents);
const mockedGetIncident = vi.mocked(getIncident);
const mockedResolveIncident = vi.mocked(resolveIncident);
const mockedGetIncidentCount = vi.mocked(getIncidentCount);
const mockedResolveIncidentsBatch = vi.mocked(resolveIncidentsBatch);
const mockedGetIncidentGroups = vi.mocked(getIncidentGroups);

describe('incidents routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();

    // Mock auth decorator
    app.decorate('authenticate', async () => {});
    app.decorate('requireRole', () => async () => undefined);
    await app.register(incidentsRoutes);
    await app.ready();
  });

  describe('GET /api/incidents', () => {
    it('should return incidents list with counts', async () => {
      mockedGetIncidents.mockResolvedValue([
        { id: 'inc-1', title: 'Test incident', severity: 'critical', status: 'active' } as never,
      ]);
      mockedGetIncidentCount.mockResolvedValue({ active: 1, resolved: 0, total: 1 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.incidents).toHaveLength(1);
      expect(body.counts.active).toBe(1);
    });

    it('should filter by status', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/incidents?status=active',
      });

      expect(mockedGetIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    // SECURITY REGRESSION: unbounded pagination DoS — limit must be coerced and
    // capped (max 1000) and an over-limit / non-numeric value must be rejected,
    // never passed through to the SQL LIMIT.
    it('rejects an over-limit value with 400 and does not query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents?limit=100000000',
      });
      expect(response.statusCode).toBe(400);
      expect(mockedGetIncidents).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric limit with 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents?limit=abc',
      });
      expect(response.statusCode).toBe(400);
      expect(mockedGetIncidents).not.toHaveBeenCalled();
    });

    it('defaults limit/offset to bounded values when omitted', async () => {
      await app.inject({ method: 'GET', url: '/api/incidents' });
      expect(mockedGetIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 }),
      );
    });

    it('accepts an in-range limit', async () => {
      await app.inject({ method: 'GET', url: '/api/incidents?limit=1000&offset=5' });
      expect(mockedGetIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1000, offset: 5 }),
      );
    });
  });

  describe('GET /api/incidents/groups', () => {
    it('should return 200 with valid query params', async () => {
      mockedGetIncidentGroups.mockResolvedValue({ groups: [], endpoint_facets: [], total_active: 0 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/groups?status=active&since=1h&severity=critical',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.groups).toBeDefined();
    });

    it('should return 400 when endpoint_id is not a number', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/groups?endpoint_id=abc',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('invalid query');
    });

    it('should return 400 when since is an invalid value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/groups?since=foo',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('invalid query');
    });
  });

  describe('GET /api/incidents/:id', () => {
    it('should return 404 for non-existent incident', async () => {
      mockedGetIncident.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return incident with related insights', async () => {
      mockedGetIncident.mockResolvedValue({
        id: 'inc-1',
        title: 'Test incident',
        root_cause_insight_id: 'insight-1',
        related_insight_ids: ['insight-2'],
      } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/inc-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe('inc-1');
      expect(body.relatedInsights).toBeDefined();
    });
  });

  describe('POST /api/incidents/:id/resolve', () => {
    it('should return 404 for non-existent incident', async () => {
      mockedGetIncident.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/non-existent/resolve',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should resolve an existing incident', async () => {
      mockedGetIncident.mockResolvedValue({ id: 'inc-1', status: 'active' } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/inc-1/resolve',
      });

      expect(response.statusCode).toBe(200);
      expect(mockedResolveIncident).toHaveBeenCalledWith('inc-1');
    });
  });

  describe('POST /api/incidents/resolve (batch)', () => {
    it('should return 400 for invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/resolve',
        payload: { ids: 'not-an-array' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for empty ids array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/resolve',
        payload: { ids: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should resolve a batch of incidents', async () => {
      const ids = [
        '550e8400-e29b-41d4-a716-446655440001',
        '550e8400-e29b-41d4-a716-446655440002',
        '550e8400-e29b-41d4-a716-446655440003',
      ];
      mockedResolveIncidentsBatch.mockResolvedValue({
        resolved: ids,
        failed: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/resolve',
        payload: { ids },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.resolved).toEqual(ids);
      expect(body.failed).toEqual([]);
      expect(mockedResolveIncidentsBatch).toHaveBeenCalledWith(ids);
    });

    it('should handle partial failures', async () => {
      const validIds = [
        '550e8400-e29b-41d4-a716-446655440001',
        '550e8400-e29b-41d4-a716-446655440003',
      ];
      const notFoundId = '00000000-0000-0000-0000-000000000000';
      const allIds = [validIds[0], notFoundId, validIds[1]];

      mockedResolveIncidentsBatch.mockResolvedValue({
        resolved: validIds,
        failed: [{ id: notFoundId, error: 'not found' }],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/resolve',
        payload: { ids: allIds },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.resolved).toEqual(validIds);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0].id).toBe(notFoundId);
    });

    it('should reject max 500 ids', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => {
        const num = i.toString().padStart(36, '0');
        return `${num.slice(0, 8)}-${num.slice(8, 12)}-${num.slice(12, 16)}-${num.slice(16, 20)}-${num.slice(20, 32)}`;
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/resolve',
        payload: { ids },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

describe('incidents RBAC', () => {
  let rbacApp: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    rbacApp = Fastify({ logger: false });
    rbacApp.decorate('authenticate', async () => undefined);
    rbacApp.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    rbacApp.decorateRequest('user', undefined);
    rbacApp.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'tester', sessionId: 's1', role: currentRole };
    });
    await rbacApp.register(incidentsRoutes);
    await rbacApp.ready();
  });

  afterAll(async () => {
    await rbacApp.close();
  });

  beforeEach(() => {
    currentRole = 'admin';
  });

  testAdminOnly(() => rbacApp, (r) => { currentRole = r; }, 'POST', '/api/incidents/inc-1/resolve');
  testAdminOnly(() => rbacApp, (r) => { currentRole = r; }, 'POST', '/api/incidents/resolve', { ids: ['550e8400-e29b-41d4-a716-446655440001'] });
});
