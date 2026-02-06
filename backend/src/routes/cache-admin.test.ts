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

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(cacheAdminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/admin/cache/stats', () => {
    it('returns cache statistics and entries', async () => {
      mockCache.getStats.mockResolvedValue({
        size: 5,
        hits: 100,
        misses: 20,
        hitRate: '83.3%',
        backend: 'memory',
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
      expect(body.backend).toBe('memory');
      expect(body.entries).toHaveLength(2);
      expect(body.entries[0].key).toBe('endpoints');
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
  });
});
