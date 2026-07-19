import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { testAdminOnly } from '@dashboard/core/test-utils/rbac-test-helper.js';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
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
const mockGetVulnerabilitiesCount = vi.fn();
const mockGetVulnerabilitySummary = vi.fn();
const mockGetExceptions = vi.fn();
const mockCreateException = vi.fn();
const mockDeactivateException = vi.fn();
const mockGetLatestSyncStatus = vi.fn();

vi.mock('../services/harbor-vulnerability-store.js', async (importOriginal) => ({
  // Keep the real pure helpers (classifySyncStatus, TRUNCATION_PREFIX) — only the
  // DB-touching functions are mocked, since there is no PostgreSQL in CI.
  ...(await importOriginal<typeof import('../services/harbor-vulnerability-store.js')>()),
  getVulnerabilities: (...args: unknown[]) => mockGetVulnerabilities(...args),
  getVulnerabilitiesCount: (...args: unknown[]) => mockGetVulnerabilitiesCount(...args),
  getVulnerabilitySummary: (...args: unknown[]) => mockGetVulnerabilitySummary(...args),
  getExceptions: (...args: unknown[]) => mockGetExceptions(...args),
  createException: (...args: unknown[]) => mockCreateException(...args),
  deactivateException: (...args: unknown[]) => mockDeactivateException(...args),
  getLatestSyncStatus: (...args: unknown[]) => mockGetLatestSyncStatus(...args),
}));

// Kept: harbor-sync mock — runs background jobs
const mockRunFullSync = vi.fn();
const mockGetIsSyncing = vi.fn();
vi.mock('../services/harbor-sync.js', () => ({
  runFullSync: (...args: unknown[]) => mockRunFullSync(...args),
  getIsSyncing: (...args: unknown[]) => mockGetIsSyncing(...args),
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

// Complete fixtures matching the real store output (#1545). GET
// /api/harbor/vulnerabilities now declares a response schema, so its serializer
// validates the payload; partial mocks (missing columns) would fail to
// serialize. `makeVuln` mirrors the 17-column harbor_vulnerabilities row and
// `makeSummary` the 9-field VulnerabilitySummary.
const makeVuln = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  cve_id: 'CVE-0000-0000',
  severity: 'High',
  cvss_v3_score: null,
  package: 'openssl',
  version: '1.0.0',
  fixed_version: null,
  status: null,
  description: null,
  links: null,
  project_id: 1,
  repository_name: 'lib/app',
  digest: 'sha256:abc',
  tags: null,
  in_use: false,
  matching_containers: null,
  synced_at: '2026-07-13T00:00:00.000Z',
  ...overrides,
});
const makeSummary = (overrides: Record<string, unknown> = {}) => ({
  total: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  in_use_total: 0,
  in_use_critical: 0,
  fixable: 0,
  excepted: 0,
  ...overrides,
});

describe('Harbor Vulnerability Routes', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: any, reply: any) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
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
    mockGetIsSyncing.mockReturnValue(false);
    mockGetVulnerabilitySummary.mockResolvedValue(makeSummary());
    mockGetVulnerabilities.mockResolvedValue([]);
    mockGetVulnerabilitiesCount.mockResolvedValue(0);
    mockGetExceptions.mockResolvedValue([]);
    mockGetLatestSyncStatus.mockResolvedValue(null);
  });

  describe('GET /api/harbor/vulnerabilities', () => {
    it('returns vulnerabilities and summary', async () => {
      const vulns = [makeVuln({ cve_id: 'CVE-2024-0001', severity: 'High' })];
      const summary = makeSummary({ high: 1, total: 1 });
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

    it('returns the filtered total plus echoed limit/offset for pagination (#1546)', async () => {
      // total (filtered) is distinct from summary.total (global) — a severity
      // filter narrows the count without touching the global KPI summary.
      mockGetVulnerabilities.mockResolvedValue([makeVuln({ cve_id: 'CVE-A', severity: 'Critical' })]);
      mockGetVulnerabilitySummary.mockResolvedValue(makeSummary({ critical: 3, high: 5, total: 8 }));
      mockGetVulnerabilitiesCount.mockResolvedValue(3);

      const response = await app.inject({
        method: 'GET',
        url: '/api/harbor/vulnerabilities?severity=Critical&limit=50&offset=100',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.total).toBe(3);
      expect(body.summary.total).toBe(8); // global summary unchanged
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(100);
      // The count must use the same filter as the row query.
      expect(mockGetVulnerabilitiesCount).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'Critical', limit: 50, offset: 100 }),
      );
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
      // Full ExceptionRecord shape (#1545) — the response schema now .parse()s
      // this, so a partial fixture (e.g. the old `active` typo for `is_active`)
      // would 500 instead of serializing.
      const created = {
        id: 1,
        cve_id: 'CVE-2024-9999',
        scope: 'global',
        scope_ref: null,
        justification: 'False positive in test environment',
        created_by: 'admin',
        approved_by: null,
        expires_at: null,
        is_active: true,
        synced_to_harbor: false,
        created_at: '2026-07-18T00:00:00.000Z',
        updated_at: '2026-07-18T00:00:00.000Z',
      };
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
      expect(response.json()).toEqual({ error: 'Exception not found' });
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
      expect(response.json()).toEqual({ error: 'Harbor is not configured' });
    });

    it('returns 409 when a sync is already in progress', async () => {
      mockGetIsSyncing.mockReturnValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/api/harbor/sync',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('already in progress');
      // Should NOT have called runFullSync
      expect(mockRunFullSync).not.toHaveBeenCalled();
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
      // Full SyncStatusRecord shape (#1545) — the response schema now .parse()s
      // this, so a partial fixture would 500 instead of serializing.
      mockGetLatestSyncStatus.mockResolvedValue({
        id: 1,
        sync_type: 'full',
        status: 'completed',
        vulnerabilities_synced: 42,
        in_use_matched: 3,
        error_message: null,
        started_at: '2026-07-18T00:00:00.000Z',
        completed_at: '2026-07-18T00:01:00.000Z',
      });

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

    it('reclassifies a truncated sync as a warning, not a hard error (#1392)', async () => {
      mockTestConnection.mockResolvedValue({ ok: true });
      mockGetLatestSyncStatus.mockResolvedValue({
        id: 7,
        sync_type: 'full',
        status: 'completed',
        vulnerabilities_synced: 200,
        in_use_matched: 5,
        error_message: 'Truncated: synced 200 of 10000 vulnerabilities (raise HARBOR_MAX_PAGES)',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:01:00Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/harbor/status',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.truncated).toBe(true);
      expect(body.syncWarning).toContain('Truncated:');
      // The truncation note must NOT surface as a hard error on lastSync.
      expect(body.lastSync.error_message).toBeNull();
    });
  });
});
