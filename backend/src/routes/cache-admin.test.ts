import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { cacheAdminRoutes } from './cache-admin.js';

vi.mock('../services/portainer-cache.js', () => ({
  cache: {
    getStats: vi.fn(),
    getEntries: vi.fn(),
    clear: vi.fn(),
    invalidatePattern: vi.fn(),
  },
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

import { cache } from '../services/portainer-cache.js';
import { writeAuditLog } from '../services/audit-logger.js';

const mockCache = vi.mocked(cache);
const mockWriteAuditLog = vi.mocked(writeAuditLog);

describe('Cache Admin Routes', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = {
        sub: 'user-1',
        username: 'viewer',
        sessionId: 'session-1',
        role: currentRole,
      };
    });
    await app.register(cacheAdminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentRole = 'admin';
    vi.clearAllMocks();
  });

  describe('GET /api/admin/cache/stats', () => {
    it('returns cache statistics and entries', async () => {
      mockCache.getStats.mockResolvedValue({
        size: 5,
        l1Size: 5,
        l2Size: 0,
        hits: 100,
        misses: 20,
        hitRate: '83.3%',
        backend: 'memory-only',
        compression: { compressedCount: 0, bytesSaved: 0, threshold: 10000 },
        redis: null,
      });
      mockCache.getEntries.mockResolvedValue([
        { key: 'endpoints', expiresIn: 120 },
        { key: 'containers:1', expiresIn: 45 },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/cache/stats',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.size).toBe(5);
      expect(body.hits).toBe(100);
      expect(body.misses).toBe(20);
      expect(body.hitRate).toBe('83.3%');
      expect(body.backend).toBe('memory-only');
      expect(body.entries).toHaveLength(2);
      expect(body.entries[0].key).toBe('endpoints');
    });

    it('rejects non-admin users', async () => {
      currentRole = 'viewer';
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/cache/stats',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });

  describe('POST /api/admin/cache/clear', () => {
    it('clears cache and writes audit log', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/cache/clear',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(mockCache.clear).toHaveBeenCalledTimes(1);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cache.clear',
          target_type: 'cache',
          target_id: '*',
        }),
      );
    });

    it('rejects non-admin users', async () => {
      currentRole = 'viewer';
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/cache/clear',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });

  describe('POST /api/admin/cache/invalidate', () => {
    it('invalidates cache pattern and writes audit log', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/cache/invalidate?resource=containers',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.resource).toBe('containers');
      expect(mockCache.invalidatePattern).toHaveBeenCalledWith('containers');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cache.invalidate',
          target_type: 'cache',
          target_id: 'containers',
        }),
      );
    });

    it('rejects invalid resource with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/cache/invalidate?resource=invalid',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing resource param with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/cache/invalidate',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects non-admin users', async () => {
      currentRole = 'viewer';
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/cache/invalidate?resource=containers',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });
});
