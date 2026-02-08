import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { ebpfCoverageRoutes } from './ebpf-coverage.js';
import {
  getEndpointCoverage,
  updateCoverageStatus,
  syncEndpointCoverage,
  verifyCoverage,
  getCoverageSummary,
} from '../services/ebpf-coverage.js';

vi.mock('../services/ebpf-coverage.js', () => ({
  getEndpointCoverage: vi.fn(() => []),
  updateCoverageStatus: vi.fn(),
  syncEndpointCoverage: vi.fn(async () => 0),
  verifyCoverage: vi.fn(async () => ({ verified: false, lastTraceAt: null, beylaRunning: false })),
  getCoverageSummary: vi.fn(() => ({
    total: 0,
    deployed: 0,
    planned: 0,
    excluded: 0,
    failed: 0,
    unknown: 0,
    coveragePercent: 0,
  })),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockedGetEndpointCoverage = vi.mocked(getEndpointCoverage);
const mockedUpdateCoverageStatus = vi.mocked(updateCoverageStatus);
const mockedSyncEndpointCoverage = vi.mocked(syncEndpointCoverage);
const mockedVerifyCoverage = vi.mocked(verifyCoverage);
const mockedGetCoverageSummary = vi.mocked(getCoverageSummary);

describe('ebpf-coverage routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);

    // Mock auth decorators
    app.decorate('authenticate', async () => {});
    app.decorate('requireRole', () => async () => {});
    await app.register(ebpfCoverageRoutes);
    await app.ready();
  });

  describe('GET /api/ebpf/coverage', () => {
    it('should return coverage list', async () => {
      const mockRecords = [
        {
          endpoint_id: 1,
          endpoint_name: 'local',
          status: 'deployed' as const,
          exclusion_reason: null,
          deployment_profile: null,
          last_trace_at: null,
          last_verified_at: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
        },
      ];
      mockedGetEndpointCoverage.mockReturnValue(mockRecords);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ebpf/coverage',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.coverage).toHaveLength(1);
      expect(body.coverage[0].endpoint_name).toBe('local');
    });

    it('should return empty coverage list', async () => {
      mockedGetEndpointCoverage.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ebpf/coverage',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.coverage).toHaveLength(0);
    });
  });

  describe('GET /api/ebpf/coverage/summary', () => {
    it('should return coverage summary', async () => {
      mockedGetCoverageSummary.mockReturnValue({
        total: 8,
        deployed: 6,
        planned: 1,
        excluded: 0,
        failed: 0,
        unknown: 1,
        not_deployed: 0,
        unreachable: 0,
        incompatible: 0,
        coveragePercent: 75,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/ebpf/coverage/summary',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.total).toBe(8);
      expect(body.deployed).toBe(6);
      expect(body.coveragePercent).toBe(75);
    });
  });

  describe('PUT /api/ebpf/coverage/:endpointId', () => {
    it('should update coverage status', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/ebpf/coverage/1',
        payload: { status: 'deployed' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedUpdateCoverageStatus).toHaveBeenCalledWith(1, 'deployed', undefined);
    });

    it('should update coverage status with reason', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/ebpf/coverage/2',
        payload: { status: 'excluded', reason: 'Development only' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedUpdateCoverageStatus).toHaveBeenCalledWith(2, 'excluded', 'Development only');
    });

    it('should reject invalid status', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/ebpf/coverage/1',
        payload: { status: 'invalid-status' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-numeric endpoint ID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/ebpf/coverage/abc',
        payload: { status: 'deployed' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/ebpf/coverage/sync', () => {
    it('should trigger endpoint sync', async () => {
      mockedSyncEndpointCoverage.mockResolvedValue(3);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/coverage/sync',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.added).toBe(3);
    });

    it('should handle sync with no new endpoints', async () => {
      mockedSyncEndpointCoverage.mockResolvedValue(0);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/coverage/sync',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.added).toBe(0);
    });
  });

  describe('POST /api/ebpf/coverage/:endpointId/verify', () => {
    it('should verify coverage with beyla running and traces found', async () => {
      mockedVerifyCoverage.mockResolvedValue({
        verified: true,
        lastTraceAt: '2025-01-01T12:00:00',
        beylaRunning: true,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/coverage/1/verify',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.verified).toBe(true);
      expect(body.beylaRunning).toBe(true);
      expect(body.lastTraceAt).toBe('2025-01-01T12:00:00');
    });

    it('should verify coverage with no beyla and no traces', async () => {
      mockedVerifyCoverage.mockResolvedValue({
        verified: false,
        lastTraceAt: null,
        beylaRunning: false,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/coverage/1/verify',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.verified).toBe(false);
      expect(body.beylaRunning).toBe(false);
      expect(body.lastTraceAt).toBeNull();
    });
  });
});
