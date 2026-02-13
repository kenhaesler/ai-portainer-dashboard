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
  deployBeyla,
  disableBeyla,
  enableBeyla,
  removeBeylaFromEndpoint,
  deployBeylaBulk,
  removeBeylaBulk,
  getEndpointOtlpOverride,
  setEndpointOtlpOverride,
} from '../services/ebpf-coverage.js';
import { getConfig } from '../config/index.js';

const { mockedNetworkInterfaces } = vi.hoisted(() => ({
  mockedNetworkInterfaces: vi.fn(() => ({
    en0: [{ address: '192.168.178.20', family: 'IPv4', internal: false }],
  })),
}));

vi.mock('node:os', () => ({
  networkInterfaces: mockedNetworkInterfaces,
}));

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
  deployBeyla: vi.fn(async () => ({ endpointId: 1, endpointName: 'local', containerId: 'b1', status: 'deployed' })),
  disableBeyla: vi.fn(async () => ({ endpointId: 1, endpointName: 'local', containerId: 'b1', status: 'disabled' })),
  enableBeyla: vi.fn(async () => ({ endpointId: 1, endpointName: 'local', containerId: 'b1', status: 'enabled' })),
  removeBeylaFromEndpoint: vi.fn(async () => ({ endpointId: 1, endpointName: 'local', containerId: 'b1', status: 'removed' })),
  deployBeylaBulk: vi.fn(async () => []),
  removeBeylaBulk: vi.fn(async () => []),
  getEndpointOtlpOverride: vi.fn(() => null),
  setEndpointOtlpOverride: vi.fn(),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn(() => ({
    PORT: 3051,
    TRACES_INGESTION_API_KEY: 'ingest-key',
    DASHBOARD_EXTERNAL_URL: '',
  })),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockedGetEndpointCoverage = vi.mocked(getEndpointCoverage);
const mockedUpdateCoverageStatus = vi.mocked(updateCoverageStatus);
const mockedSyncEndpointCoverage = vi.mocked(syncEndpointCoverage);
const mockedVerifyCoverage = vi.mocked(verifyCoverage);
const mockedGetCoverageSummary = vi.mocked(getCoverageSummary);
const mockedDeployBeyla = vi.mocked(deployBeyla);
const mockedDisableBeyla = vi.mocked(disableBeyla);
const mockedEnableBeyla = vi.mocked(enableBeyla);
const mockedRemoveBeylaFromEndpoint = vi.mocked(removeBeylaFromEndpoint);
const mockedDeployBeylaBulk = vi.mocked(deployBeylaBulk);
const mockedRemoveBeylaBulk = vi.mocked(removeBeylaBulk);
const mockedGetEndpointOtlpOverride = vi.mocked(getEndpointOtlpOverride);
const mockedSetEndpointOtlpOverride = vi.mocked(setEndpointOtlpOverride);
const mockedGetConfig = vi.mocked(getConfig);

describe('ebpf-coverage routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockedNetworkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.178.20', family: 'IPv4', internal: false }],
    });
    mockedGetConfig.mockReturnValue({
      PORT: 3051,
      TRACES_INGESTION_API_KEY: 'ingest-key',
      DASHBOARD_EXTERNAL_URL: '',
    } as any);
    mockedGetEndpointOtlpOverride.mockReturnValue(null);
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
          beyla_enabled: 1,
          beyla_container_id: 'b1',
          beyla_managed: 1,
          otlp_endpoint_override: null,
          drifted: false,
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

  describe('PUT /api/ebpf/coverage/:endpointId/otlp-endpoint', () => {
    it('stores an endpoint-specific OTLP override', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/ebpf/coverage/1/otlp-endpoint',
        payload: { otlpEndpointOverride: 'https://edge-reachable.example.com/api/traces/otlp' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedSetEndpointOtlpOverride).toHaveBeenCalledWith(1, 'https://edge-reachable.example.com/api/traces/otlp');
    });

    it('clears endpoint-specific OTLP override with null', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/ebpf/coverage/1/otlp-endpoint',
        payload: { otlpEndpointOverride: null },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedSetEndpointOtlpOverride).toHaveBeenCalledWith(1, null);
    });
  });

  describe('Beyla lifecycle routes', () => {
    it('POST /api/ebpf/deploy/:endpointId deploys beyla', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: {},
        headers: { host: 'dashboard.example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'http://dashboard.example.com/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: false,
      });
    });

    it('POST /api/ebpf/deploy/:endpointId accepts OTLP endpoint from request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: { otlpEndpoint: 'http://192.168.178.20:3051/api/traces/otlp' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedSetEndpointOtlpOverride).toHaveBeenCalledWith(1, 'http://192.168.178.20:3051/api/traces/otlp');
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'http://192.168.178.20:3051/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: true,
      });
    });

    it('POST /api/ebpf/deploy/:endpointId accepts host-only input and auto-builds OTLP URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: { otlpEndpoint: '192.168.178.20' },
        headers: { host: 'localhost:3051' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedSetEndpointOtlpOverride).toHaveBeenCalledWith(1, 'http://192.168.178.20:3051/api/traces/otlp');
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'http://192.168.178.20:3051/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: true,
      });
    });

    it('POST /api/ebpf/deploy/:endpointId uses endpoint-specific OTLP override when present', async () => {
      mockedGetEndpointOtlpOverride.mockReturnValueOnce('https://override.example.com/api/traces/otlp');
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: {},
        headers: { host: 'dashboard.example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'https://override.example.com/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: false,
      });
    });

    it('POST /api/ebpf/disable/:endpointId disables beyla', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/disable/1',
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDisableBeyla).toHaveBeenCalledWith(1);
    });

    it('POST /api/ebpf/deploy/:endpointId prefers DASHBOARD_EXTERNAL_URL when configured', async () => {
      mockedGetConfig.mockReturnValue({
        PORT: 3051,
        TRACES_INGESTION_API_KEY: 'ingest-key',
        DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com',
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: {},
        headers: { host: 'localhost:3051' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'https://dashboard.example.com/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: false,
      });
    });

    it('POST /api/ebpf/deploy/:endpointId auto-resolves local LAN IP when host is localhost', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: {},
        headers: { host: 'localhost:3051' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'http://192.168.178.20:3051/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: false,
      });
    });

    it('POST /api/ebpf/deploy/:endpointId respects forwarded https host when behind reverse proxy', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/1',
        payload: {},
        headers: {
          host: 'backend:3051',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'dashboard.example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDeployBeyla).toHaveBeenCalledWith(1, {
        otlpEndpoint: 'https://dashboard.example.com/api/traces/otlp',
        tracesApiKey: 'ingest-key',
        recreateExisting: false,
      });
    });

    it('POST /api/ebpf/enable/:endpointId enables beyla', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/enable/1',
      });

      expect(response.statusCode).toBe(200);
      expect(mockedEnableBeyla).toHaveBeenCalledWith(1);
    });

    it('DELETE /api/ebpf/remove/:endpointId removes beyla', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/ebpf/remove/1?force=true',
      });

      expect(response.statusCode).toBe(200);
      expect(mockedRemoveBeylaFromEndpoint).toHaveBeenCalledWith(1, true);
    });

    it('POST /api/ebpf/deploy/bulk deploys to multiple endpoints', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ebpf/deploy/bulk',
        payload: { endpointIds: [1, 2] },
        headers: { host: 'dashboard.example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedDeployBeylaBulk).toHaveBeenCalledWith(
        [1, 2],
        expect.objectContaining({
          tracesApiKey: 'ingest-key',
          resolveOtlpEndpoint: expect.any(Function),
        }),
      );
    });

    it('DELETE /api/ebpf/remove/bulk removes from multiple endpoints', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/ebpf/remove/bulk?force=false',
        payload: { endpointIds: [1, 2] },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedRemoveBeylaBulk).toHaveBeenCalledWith([1, 2], false);
    });
  });
});
