import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { testAdminOnly } from '../test-utils/rbac-test-helper.js';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { pcapRoutes } from './pcap.js';

const mockStartCapture = vi.fn();
const mockStopCapture = vi.fn();
const mockGetCaptureById = vi.fn();
const mockListCaptures = vi.fn();
const mockDeleteCaptureById = vi.fn();
const mockGetCaptureFilePath = vi.fn();
const mockAnalyzeCapture = vi.fn();
const mockAssertCapability = vi.fn();

// Kept: pcap-service mock — no Portainer API in CI
vi.mock('../services/pcap-service.js', () => ({
  startCapture: (...args: unknown[]) => mockStartCapture(...args),
  stopCapture: (...args: unknown[]) => mockStopCapture(...args),
  getCaptureById: (...args: unknown[]) => mockGetCaptureById(...args),
  listCaptures: (...args: unknown[]) => mockListCaptures(...args),
  deleteCaptureById: (...args: unknown[]) => mockDeleteCaptureById(...args),
  getCaptureFilePath: (...args: unknown[]) => mockGetCaptureFilePath(...args),
}));

// Kept: pcap-analysis-service mock — no Ollama in CI
vi.mock('../services/pcap-analysis-service.js', () => ({
  analyzeCapture: (...args: unknown[]) => mockAnalyzeCapture(...args),
}));

// Kept: edge-capability-guard mock — no Portainer API in CI
vi.mock('../services/edge-capability-guard.js', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

// Kept: audit-logger mock — side-effect isolation
vi.mock('../core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

// Kept: fs mock — external dependency
vi.mock('fs', () => ({
  default: {
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
  },
}));

describe('PCAP Routes', () => {
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
      request.user = { sub: 'u1', username: 'test-user', sessionId: 's1', role: currentRole };
    });
    await app.register(pcapRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'admin';
  });

  describe('POST /api/pcap/captures', () => {
    it('should start a capture with valid input', async () => {
      mockStartCapture.mockResolvedValue({
        id: 'capture-1',
        status: 'capturing',
        endpoint_id: 1,
        container_id: 'abc123',
        container_name: 'web',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures',
        headers: { authorization: 'Bearer test' },
        payload: {
          endpointId: 1,
          containerId: 'abc123',
          containerName: 'web',
          filter: 'port 80',
          durationSeconds: 60,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('capture-1');
      expect(body.status).toBe('capturing');
      expect(mockStartCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: 1,
          containerId: 'abc123',
          containerName: 'web',
          filter: 'port 80',
          durationSeconds: 60,
        }),
      );
    });

    it('should reject invalid BPF filter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures',
        headers: { authorization: 'Bearer test' },
        payload: {
          endpointId: 1,
          containerId: 'abc123',
          containerName: 'web',
          filter: 'port 80; rm -rf /',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mockStartCapture).not.toHaveBeenCalled();
    });

    it('should reject missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures',
        headers: { authorization: 'Bearer test' },
        payload: { endpointId: 1 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when service throws', async () => {
      mockStartCapture.mockRejectedValue(new Error('PCAP not enabled'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures',
        headers: { authorization: 'Bearer test' },
        payload: {
          endpointId: 1,
          containerId: 'abc123',
          containerName: 'web',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('PCAP not enabled');
    });

    it('should return 422 when Edge Async endpoint lacks exec capability', async () => {
      const capErr = new Error('Edge Async endpoints do not support "exec" operations.');
      (capErr as any).statusCode = 422;
      mockAssertCapability.mockRejectedValue(capErr);

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures',
        headers: { authorization: 'Bearer test' },
        payload: {
          endpointId: 5,
          containerId: 'abc123',
          containerName: 'web',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Edge Async');
      expect(mockStartCapture).not.toHaveBeenCalled();
    });

    testAdminOnly(
      () => app, (r) => { currentRole = r; },
      'POST', '/api/pcap/captures',
      { endpointId: 1, containerId: 'abc123', containerName: 'web' },
    );
  });

  describe('GET /api/pcap/captures', () => {
    it('should return list of captures', async () => {
      mockListCaptures.mockReturnValue([
        { id: 'c1', status: 'complete' },
        { id: 'c2', status: 'capturing' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/pcap/captures',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.captures).toHaveLength(2);
    });

    it('should pass status filter', async () => {
      mockListCaptures.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/pcap/captures?status=complete',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockListCaptures).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'complete' }),
      );
    });
  });

  describe('GET /api/pcap/captures/:id', () => {
    it('should return a capture', async () => {
      mockGetCaptureById.mockReturnValue({ id: 'c1', status: 'complete' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/pcap/captures/c1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('c1');
    });

    it('should return 404 for non-existent capture', async () => {
      mockGetCaptureById.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/pcap/captures/not-found',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/pcap/captures/:id/stop', () => {
    it('should stop a capture', async () => {
      mockStopCapture.mockResolvedValue({
        id: 'c1',
        status: 'succeeded',
        container_id: 'abc',
        container_name: 'web',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures/c1/stop',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('succeeded');
    });

    it('should return 400 when stop fails', async () => {
      mockStopCapture.mockRejectedValue(new Error('Cannot stop'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures/c1/stop',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'POST', '/api/pcap/captures/c1/stop');
  });

  describe('GET /api/pcap/captures/:id/download', () => {
    it('should return 404 when file not found', async () => {
      mockGetCaptureFilePath.mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/pcap/captures/c1/download',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/pcap/captures/:id/analyze', () => {
    it('should return analysis result on success', async () => {
      mockAnalyzeCapture.mockResolvedValue({
        health_status: 'healthy',
        summary: 'Normal traffic patterns',
        findings: [],
        confidence_score: 0.9,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures/c1/analyze',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.health_status).toBe('healthy');
      expect(body.confidence_score).toBe(0.9);
      expect(mockAnalyzeCapture).toHaveBeenCalledWith('c1');
    });

    it('should return 400 when analysis fails', async () => {
      mockAnalyzeCapture.mockRejectedValue(new Error('Capture not found'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures/c1/analyze',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Capture not found');
    });

    it('should return 400 for non-complete captures', async () => {
      mockAnalyzeCapture.mockRejectedValue(new Error('Cannot analyze capture in status: capturing'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/pcap/captures/c1/analyze',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Cannot analyze');
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'POST', '/api/pcap/captures/c1/analyze');
  });

  describe('DELETE /api/pcap/captures/:id', () => {
    it('should delete a capture', async () => {
      mockGetCaptureById.mockReturnValue({ id: 'c1', container_id: 'abc', container_name: 'web' });
      mockDeleteCaptureById.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/pcap/captures/c1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 400 when delete fails', async () => {
      mockGetCaptureById.mockReturnValue(undefined);
      mockDeleteCaptureById.mockImplementation(() => { throw new Error('Not found'); });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/pcap/captures/c1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'DELETE', '/api/pcap/captures/c1');
  });
});
