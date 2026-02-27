import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';
import { monitoringRoutes, type MonitoringRoutesOpts } from '@dashboard/ai';

// vi.hoisted: declares testDb before vi.mock factories run (prevents TDZ when
// @dashboard/ai barrel eagerly loads services that call getDbForDomain at module level)
const { dbRef } = vi.hoisted(() => ({ dbRef: { current: undefined as AppDb | undefined } }));

const mockGetSecurityAudit = vi.fn();
const mockGetSecurityAuditIgnoreList = vi.fn();
const mockSetSecurityAuditIgnoreList = vi.fn();

// Kept: security-audit mock — no Portainer API in CI
vi.mock('@dashboard/security', () => ({
  SECURITY_AUDIT_IGNORE_KEY: 'security_audit_ignore_list',
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS: ['portainer', 'traefik'],
  getSecurityAudit: (...args: unknown[]) => mockGetSecurityAudit(...args),
  getSecurityAuditIgnoreList: (...args: unknown[]) => mockGetSecurityAuditIgnoreList(...args),
  setSecurityAuditIgnoreList: (...args: unknown[]) => mockSetSecurityAuditIgnoreList(...args),
}));

// Kept: app-db-router mock — uses dbRef to avoid TDZ with hoisted vi.mock
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => dbRef.current,
}));

// Needed: audit-logger calls getDbForDomain at module load time (via @dashboard/ai barrel)
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

let testDb: AppDb;
beforeAll(async () => { testDb = await getTestDb(); dbRef.current = testDb; });
afterAll(async () => { await closeTestDb(); });

describe('security audit routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    const monitoringOpts: MonitoringRoutesOpts = {
      getSecurityAudit: (...args: unknown[]) => mockGetSecurityAudit(...args),
      getSecurityAuditIgnoreList: (...args: unknown[]) => mockGetSecurityAuditIgnoreList(...args),
      setSecurityAuditIgnoreList: (...args: unknown[]) => mockSetSecurityAuditIgnoreList(...args),
      defaultSecurityAuditIgnorePatterns: ['portainer', 'traefik'],
      securityAuditIgnoreKey: 'security_audit_ignore_list',
    };
    await app.register(monitoringRoutes, monitoringOpts);
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns security audit entries for all endpoints', async () => {
    mockGetSecurityAudit.mockResolvedValue([{ containerName: 'api', findings: [], ignored: false }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/audit',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toHaveLength(1);
    expect(mockGetSecurityAudit).toHaveBeenCalledWith();
  });

  it('returns scoped audit entries by endpoint id', async () => {
    mockGetSecurityAudit.mockResolvedValue([{ containerName: 'api', findings: [], ignored: false }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/audit/3',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetSecurityAudit).toHaveBeenCalledWith(3);
  });

  it('returns ignore list', async () => {
    mockGetSecurityAuditIgnoreList.mockReturnValue(['portainer', 'traefik']);

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/ignore-list',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().patterns).toEqual(['portainer', 'traefik']);
  });

  it('updates ignore list', async () => {
    mockSetSecurityAuditIgnoreList.mockReturnValue(['portainer', 'traefik', 'infra-*']);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/security/ignore-list',
      headers: { authorization: 'Bearer test' },
      payload: { patterns: ['portainer', 'traefik', 'infra-*'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(mockSetSecurityAuditIgnoreList).toHaveBeenCalledWith(['portainer', 'traefik', 'infra-*']);
  });
});
