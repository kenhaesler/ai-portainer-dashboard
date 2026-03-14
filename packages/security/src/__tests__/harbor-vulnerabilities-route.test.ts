import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { testAdminOnly } from '@dashboard/core/test-utils/rbac-test-helper.js';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { harborVulnerabilityRoutes } from '../routes/harbor-vulnerabilities.js';

// Kept: harbor-client mock — no Harbor registry in CI
const mockIsHarborConfiguredAsync = vi.fn();
const mockTestConnection = vi.fn();
const mockGetSecuritySummary = vi.fn();
const mockGetProjects = vi.fn();

vi.mock('../services/harbor-client.js', () => ({
  isHarborConfiguredAsync: (...args: unknown[]) => mockIsHarborConfiguredAsync(...args),
  testConnection: (...args: unknown[]) => mockTestConnection(...args),
  getSecuritySummary: (...args: unknown[]) => mockGetSecuritySummary(...args),
  getProjects: (...args: unknown[]) => mockGetProjects(...args),
}));

// Kept: harbor-vulnerability-store mock — no PostgreSQL in CI
const mockGetVulnerabilities = vi.fn();
const mockGetVulnerabilitySummary = vi.fn();
const mockGetExceptions = vi.fn();
const mockCreateException = vi.fn();
const mockDeactivateException = vi.fn();
const mockGetLatestSyncStatus = vi.fn();

vi.mock('../services/harbor-vulnerability-store.js', () => ({
  getVulnerabilities: (...args: unknown[]) => mockGetVulnerabilities(...args),
  getVulnerabilitySummary: (...args: unknown[]) => mockGetVulnerabilitySummary(...args),
  getExceptions: (...args: unknown[]) => mockGetExceptions(...args),
  createException: (...args: unknown[]) => mockCreateException(...args),
  deactivateException: (...args: unknown[]) => mockDeactivateException(...args),
  getLatestSyncStatus: (...args: unknown[]) => mockGetLatestSyncStatus(...args),
}));

// Kept: harbor-sync mock — runs background jobs
const mockRunFullSync = vi.fn();
vi.mock('../services/harbor-sync.js', () => ({
  runFullSync: (...args: unknown[]) => mockRunFullSync(...args),
}));

// Kept: settings-store mock — reads from DB
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveHarborConfig: vi.fn().mockResolvedValue({
    enabled: true,
    apiUrl: 'https://harbor.example.com',
    robotName: 'robot$ci',
    robotSecret: 'secret',
  }),
}));

// Kept: audit-logger mock — side-effect isolation
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

describe('Harbor Vulnerability Routes', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: any, reply: any) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: currentRole };
    });
    await app.register(harborVulnerabilityRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'admin';
    mockIsHarborConfiguredAsync.mockResolvedValue(true);
    mockGetVulnerabilitySummary.mockResolvedValue({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
    mockGetVulnerabilities.mockResolvedValue([]);
    mockGetExceptions.mockResolvedValue([]);
    mockGetLatestSyncStatus.mockResolvedValue(null);
  });

  describe('GET /api/harbor/vulnerabilities', () => {
    it('returns vulnerabilities and summary', async () => {
      const vulns = [{ id: 1, cve_id: 'CVE-2024-0001', severity: 'HIGH', package_name: 'openssl' }];
      const summary = { critical: 0, high: 1, medium: 0, low: 0, total: 1 };
      mockGetVulnerabilities.mockResolvedValue(vulns);
      mockGetVulnerabilitySummary.mockResolvedValue(summary);

      const response = await app.inject({
        method: 'GET',
        url: '/api/harbor/vulnerabilities',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.vulnerabilities).toHaveLength(1);
      expect(body.vulnerabilities[0].cve_id).toBe('CVE-2024-0001');
      expect(body.summary.high).toBe(1);
    });

    it('passes severity filter to store', async () => {
      mockGetVulnerabilities.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/harbor/vulnerabilities?severity=CRITICAL',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockGetVulnerabilities).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'CRITICAL' }),
      );
    });

    it('applies default pagination values', async () => {
      mockGetVulnerabilities.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/harbor/vulnerabilities',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockGetVulnerabilities).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200, offset: 0 }),
      );
    });
  });

  describe('POST /api/harbor/exceptions', () => {
    const validBody = {
      cve_id: 'CVE-2024-9999',
      scope: 'global',
      justification: 'False positive in test environment',
    };

    it('creates a CVE exception', async () => {
      const created = { id: 1, cve_id: 'CVE-2024-9999', scope: 'global', active: true };
      mockCreateException.mockResolvedValue(created);

      const response = await app.inject({
        method: 'POST',
        url: '/api/harbor/exceptions',
        headers: { authorization: 'Bearer test' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.cve_id).toBe('CVE-2024-9999');
      expect(mockCreateException).toHaveBeenCalledWith(
        expect.objectContaining({ cve_id: 'CVE-2024-9999', created_by: 'admin' }),
      );
    });

    it('rejects missing justification', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/harbor/exceptions',
        headers: { authorization: 'Bearer test' },
        payload: { cve_id: 'CVE-2024-9999', scope: 'global', justification: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });

    testAdminOnly(
      () => app, (r) => { currentRole = r; },
      'POST', '/api/harbor/exceptions',
      validBody,
    );
  });

  describe('DELETE /api/harbor/exceptions/:id', () => {
    it('deactivates an exception', async () => {
      mockDeactivateException.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/harbor/exceptions/42',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(mockDeactivateException).toHaveBeenCalledWith(42);
    });

    it('returns 404 when exception not found', async () => {
      mockDeactivateException.mockResolvedValue(false);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/harbor/exceptions/999',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
    });

    testAdminOnly(
      () => app, (r) => { currentRole = r; },
      'DELETE', '/api/harbor/exceptions/1',
    );
  });

  describe('POST /api/harbor/sync', () => {
    it('triggers a sync and returns immediately', async () => {
      mockRunFullSync.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/harbor/sync',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('running');
    });

    it('returns 503 when Harbor is not configured', async () => {
      mockIsHarborConfiguredAsync.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/api/harbor/sync',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(503);
    });

    testAdminOnly(
      () => app, (r) => { currentRole = r; },
      'POST', '/api/harbor/sync',
    );
  });

  describe('GET /api/harbor/status', () => {
    it('returns not-configured when Harbor is off', async () => {
      mockIsHarborConfiguredAsync.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/harbor/status',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.configured).toBe(false);
    });

    it('returns connection status when configured', async () => {
      mockIsHarborConfiguredAsync.mockResolvedValue(true);
      mockTestConnection.mockResolvedValue({ ok: true });
      mockGetLatestSyncStatus.mockResolvedValue({ id: 1, status: 'completed' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/harbor/status',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.configured).toBe(true);
      expect(body.connected).toBe(true);
    });
  });
});
