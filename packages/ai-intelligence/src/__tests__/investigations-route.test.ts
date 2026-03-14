import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { investigationRoutes } from '../routes/investigations.js';

// Kept: investigation-store mock — no PostgreSQL in CI
const mockGetInvestigations = vi.fn();
const mockGetInvestigation = vi.fn();
const mockGetInvestigationByInsightId = vi.fn();

vi.mock('../services/investigation-store.js', () => ({
  getInvestigations: (...args: unknown[]) => mockGetInvestigations(...args),
  getInvestigation: (...args: unknown[]) => mockGetInvestigation(...args),
  getInvestigationByInsightId: (...args: unknown[]) => mockGetInvestigationByInsightId(...args),
}));

// Kept: DB router mock — investigation-store imports getDbForDomain at module level
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue({ changes: 0 }),
    transaction: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  }),
}));

const sampleInvestigation = {
  id: 'inv-001',
  insight_id: 'ins-abc',
  endpoint_id: 1,
  container_id: 'abc123',
  container_name: 'web',
  status: 'completed' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  insight_title: 'High CPU usage',
  insight_severity: 'critical',
  insight_category: 'anomaly',
};

describe('Investigation Routes', () => {
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
    await app.register(investigationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/investigations', () => {
    it('returns list of investigations', async () => {
      mockGetInvestigations.mockResolvedValue([sampleInvestigation]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/investigations',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.investigations).toHaveLength(1);
      expect(body.investigations[0].id).toBe('inv-001');
    });

    it('returns empty list when no investigations', async () => {
      mockGetInvestigations.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/investigations',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.investigations).toEqual([]);
    });

    it('passes status filter to store', async () => {
      mockGetInvestigations.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/investigations?status=complete',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockGetInvestigations).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'complete' }),
      );
    });

    it('passes container_id filter to store', async () => {
      mockGetInvestigations.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/investigations?container_id=abc123',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockGetInvestigations).toHaveBeenCalledWith(
        expect.objectContaining({ container_id: 'abc123' }),
      );
    });

    it('passes limit and offset', async () => {
      mockGetInvestigations.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/investigations?limit=10&offset=5',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockGetInvestigations).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });
  });

  describe('GET /api/investigations/:id', () => {
    it('returns a single investigation by id', async () => {
      mockGetInvestigation.mockResolvedValue(sampleInvestigation);

      const response = await app.inject({
        method: 'GET',
        url: '/api/investigations/inv-001',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('inv-001');
      expect(body.status).toBe('completed');
    });

    it('returns 404 when investigation not found', async () => {
      mockGetInvestigation.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/investigations/non-existent',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Investigation not found');
    });
  });

  describe('GET /api/investigations/by-insight/:insightId', () => {
    it('returns investigation linked to an insight', async () => {
      mockGetInvestigationByInsightId.mockResolvedValue(sampleInvestigation);

      const response = await app.inject({
        method: 'GET',
        url: '/api/investigations/by-insight/ins-abc',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('inv-001');
      expect(mockGetInvestigationByInsightId).toHaveBeenCalledWith('ins-abc');
    });

    it('returns 404 when no investigation exists for insight', async () => {
      mockGetInvestigationByInsightId.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/investigations/by-insight/ins-missing',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('No investigation found for this insight');
    });
  });
});
