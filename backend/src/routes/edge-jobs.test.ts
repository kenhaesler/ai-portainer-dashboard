import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { edgeJobsRoutes } from './edge-jobs.js';

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../services/portainer-client.js', async (importOriginal) => await importOriginal());

// Kept: audit-logger mock — avoids side effects from real audit log writes
vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

import * as portainerClient from '../services/portainer-client.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { cache, waitForInFlight } from '../services/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEdgeJobs: any;
let mockGetEdgeJob: any;
let mockCreateEdgeJob: any;
let mockDeleteEdgeJob: any;
const mockWriteAuditLog = vi.mocked(writeAuditLog);

afterEach(async () => {
  await waitForInFlight();
});

afterAll(async () => {
  await closeTestRedis();
});

function buildApp(currentRole: 'viewer' | 'operator' | 'admin' = 'admin') {
  const app = Fastify();
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
    request.user = { sub: 'u1', username: 'test-user', sessionId: 's1', role: currentRole };
  });
  app.register(edgeJobsRoutes);
  return app;
}

const fakeEdgeJob = (id: number, name: string) => ({
  Id: id,
  Name: name,
  CronExpression: '0 * * * *',
  Recurring: true,
  Created: 1700000000,
  Version: 1,
});

describe('edge-jobs routes', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockGetEdgeJobs = vi.spyOn(portainerClient, 'getEdgeJobs');
    mockGetEdgeJob = vi.spyOn(portainerClient, 'getEdgeJob');
    mockCreateEdgeJob = vi.spyOn(portainerClient, 'createEdgeJob');
    mockDeleteEdgeJob = vi.spyOn(portainerClient, 'deleteEdgeJob');
  });

  describe('GET /api/edge-jobs', () => {
    it('returns list of edge jobs', async () => {
      mockGetEdgeJobs.mockResolvedValue([
        fakeEdgeJob(1, 'backup-job'),
        fakeEdgeJob(2, 'cleanup-job'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/edge-jobs',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(2);
      expect(body[0].Name).toBe('backup-job');
    });
  });

  describe('GET /api/edge-jobs/:id', () => {
    it('returns a single edge job', async () => {
      mockGetEdgeJob.mockResolvedValue(fakeEdgeJob(1, 'backup-job') as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/edge-jobs/1',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.Id).toBe(1);
      expect(body.Name).toBe('backup-job');
    });
  });

  describe('POST /api/edge-jobs', () => {
    it('creates an edge job and audit logs', async () => {
      mockCreateEdgeJob.mockResolvedValue(fakeEdgeJob(3, 'new-job') as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/edge-jobs',
        payload: {
          name: 'new-job',
          cronExpression: '*/5 * * * *',
          recurring: true,
          endpoints: [1, 2],
          fileContent: '#!/bin/sh\necho hello',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.Name).toBe('new-job');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'edge_job.create',
          target_type: 'edge_job',
          target_id: '3',
        }),
      );
    });

    it('rejects invalid body', async () => {
      const app = buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/edge-jobs',
        payload: {
          name: '',
          cronExpression: '',
          recurring: true,
          endpoints: [],
          fileContent: '',
        },
      });

      expect(res.statusCode).toBe(500); // Zod parse error
    });

    it('returns 403 for authenticated non-admin users', async () => {
      const app = buildApp('viewer');
      const res = await app.inject({
        method: 'POST',
        url: '/api/edge-jobs',
        payload: {
          name: 'new-job',
          cronExpression: '*/5 * * * *',
          recurring: true,
          endpoints: [1],
          fileContent: '#!/bin/sh\necho hello',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(mockCreateEdgeJob).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/edge-jobs/:id', () => {
    it('deletes an edge job and audit logs', async () => {
      mockDeleteEdgeJob.mockResolvedValue(undefined);

      const app = buildApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/edge-jobs/5',
      });

      expect(res.statusCode).toBe(204);
      expect(mockDeleteEdgeJob).toHaveBeenCalledWith(5);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'edge_job.delete',
          target_type: 'edge_job',
          target_id: '5',
        }),
      );
    });

    it('returns 403 for authenticated non-admin users', async () => {
      const app = buildApp('operator');
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/edge-jobs/5',
      });

      expect(res.statusCode).toBe(403);
      expect(mockDeleteEdgeJob).not.toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    it('requires auth on all routes', async () => {
      const app = Fastify();
      app.setValidatorCompiler(validatorCompiler);
      // Decorate authenticate to reject
      app.decorate('authenticate', async (_req: any, reply: any) => {
        reply.code(401).send({ error: 'Unauthorized' });
      });
      app.decorate('requireRole', () => async () => undefined);
      app.register(edgeJobsRoutes);

      const routes = [
        { method: 'GET' as const, url: '/api/edge-jobs' },
        { method: 'GET' as const, url: '/api/edge-jobs/1' },
        { method: 'POST' as const, url: '/api/edge-jobs' },
        { method: 'DELETE' as const, url: '/api/edge-jobs/1' },
      ];

      for (const route of routes) {
        const res = await app.inject(route);
        expect(res.statusCode).toBe(401);
      }
    });
  });
});
