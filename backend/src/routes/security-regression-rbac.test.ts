/**
 * Security Regression — RBAC Enforcement (admin/operator gates)
 *
 * Verifies role-based access control on mutating + sensitive routes:
 *   • Remediation Approval Gate (status transitions + admin-only execute)
 *   • PCAP Admin RBAC (start/list/get/stop/analyze/delete) — issue #1020
 *   • Edge Jobs Admin RBAC (create/delete)
 *   • Operational Triggers (image staleness, notifications test)
 *   • LLM Observability source-level admin guard — issue #1029
 *   • Incident Resolve Admin RBAC — issue #1028
 *   • Users route — assertUser defensive fail-loud — issue #1110
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/430
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ─── Service Mocks ─────────────────────────────────────────────────────
let mockRemediationAction: Record<string, unknown> | undefined;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: vi.fn(() => ({
    queryOne: vi.fn(async (sql: string) => {
      if (sql.includes('FROM actions WHERE id = ?')) {
        return mockRemediationAction;
      }
      if (sql.includes('SELECT COUNT(*)')) {
        return { count: 0 };
      }
      return null;
    }),
    query: vi.fn(async () => []),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('UPDATE actions') && sql.includes("status = 'executing'")) {
        if (mockRemediationAction && mockRemediationAction.status === 'approved') {
          mockRemediationAction = { ...mockRemediationAction, status: 'executing' };
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (sql.includes('UPDATE actions') && sql.includes("status = 'completed'")) {
        if (mockRemediationAction) {
          mockRemediationAction = {
            ...mockRemediationAction,
            status: 'completed',
            execution_result: params[0] as string,
            execution_duration_ms: params[1] as number,
          };
        }
        return { changes: 1 };
      }
      if (sql.includes('UPDATE actions') && sql.includes("status = 'failed'")) {
        if (mockRemediationAction) {
          mockRemediationAction = {
            ...mockRemediationAction,
            status: 'failed',
            execution_result: params[0] as string,
            execution_duration_ms: params[1] as number,
          };
        }
        return { changes: 1 };
      }
      if (sql.includes('UPDATE actions') && sql.includes("status = 'approved'")) {
        if (mockRemediationAction && mockRemediationAction.status === 'pending') {
          mockRemediationAction = { ...mockRemediationAction, status: 'approved' };
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      return { changes: 0 };
    }),
    transaction: vi.fn(async (fn: (db: Record<string, unknown>) => Promise<unknown>) => fn({
      execute: vi.fn(async () => ({ changes: 0 })),
      queryOne: vi.fn(async () => null),
      query: vi.fn(async () => []),
    })),
    healthCheck: vi.fn(async () => true),
  })),
}));

vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
  isMetricsDbHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock('@dashboard/core/utils/crypto.js', async (importOriginal) => await importOriginal());

vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: vi.fn(() => ({ id: 'sess-1', user_id: 'u1', username: 'admin' })),
  getSession: vi.fn(() => null),
  invalidateSession: vi.fn(),
  refreshSession: vi.fn(() => null),
}));

vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('@dashboard/core/services/user-store.js', () => ({
  authenticateUser: vi.fn().mockResolvedValue(null),
  ensureDefaultAdmin: vi.fn().mockResolvedValue(undefined),
  getUserDefaultLandingPage: vi.fn(() => '/'),
  setUserDefaultLandingPage: vi.fn(),
  listUsers: vi.fn(() => []),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  hasMinRole: vi.fn(() => false),
}));

vi.mock('@dashboard/core/services/oidc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dashboard/core/services/oidc.js')>();
  return {
    ...actual,
    getOIDCConfig: vi.fn(() => null),
    generateAuthorizationUrl: vi.fn().mockResolvedValue({ url: '', state: '' }),
    exchangeCode: vi.fn().mockResolvedValue(null),
    getEffectiveRedirectUri: vi.fn(() => ({ redirectUri: 'http://localhost/auth/callback', source: 'env' })),
  };
});

vi.mock('@dashboard/core/services/oidc-group-tracking.js', () => ({
  syncUserGroups: vi.fn().mockResolvedValue(undefined),
  listDiscoveredGroups: vi.fn().mockResolvedValue([]),
}));

vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => await importOriginal());

vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveLlmConfig: vi.fn(() => ({
    model: 'llama3.2',
    ollamaUrl: 'http://localhost:11434',
    customEnabled: false,
    customEndpointUrl: '',
    customEndpointToken: '',
  })),
}));

vi.mock('@dashboard/security', () => ({
  getSecurityAudit: vi.fn().mockResolvedValue({ findings: [], summary: {} }),
  buildSecurityAuditSummary: vi.fn(() => ({})),
  getSecurityAuditIgnoreList: vi.fn(() => []),
  setSecurityAuditIgnoreList: vi.fn(),
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS: [],
  SECURITY_AUDIT_IGNORE_KEY: 'security_audit_ignore',
  getEndpointCoverage: vi.fn().mockResolvedValue([]),
  updateCoverageStatus: vi.fn().mockResolvedValue(undefined),
  deleteCoverageRecord: vi.fn().mockResolvedValue(true),
  syncEndpointCoverage: vi.fn().mockResolvedValue(undefined),
  verifyCoverage: vi.fn().mockResolvedValue(undefined),
  getCoverageSummary: vi.fn().mockResolvedValue({ total: 0, deployed: 0 }),
  deployBeyla: vi.fn().mockResolvedValue(undefined),
  disableBeyla: vi.fn().mockResolvedValue(undefined),
  enableBeyla: vi.fn().mockResolvedValue(undefined),
  removeBeylaFromEndpoint: vi.fn().mockResolvedValue(undefined),
  deployBeylaBulk: vi.fn().mockResolvedValue([]),
  removeBeylaBulk: vi.fn().mockResolvedValue([]),
  getEndpointOtlpOverride: vi.fn().mockResolvedValue(null),
  setEndpointOtlpOverride: vi.fn().mockResolvedValue(undefined),
  getStalenessRecords: vi.fn().mockResolvedValue([]),
  getStalenessSummary: vi.fn().mockResolvedValue({ total: 0, stale: 0 }),
  runStalenessChecks: vi.fn().mockResolvedValue(undefined),
  startCapture: vi.fn().mockResolvedValue({ id: 'cap-1' }),
  stopCapture: vi.fn().mockResolvedValue(undefined),
  getCaptureById: vi.fn(() => null),
  listCaptures: vi.fn(() => []),
  deleteCaptureById: vi.fn(),
  getCaptureFilePath: vi.fn(() => null),
  analyzeCapture: vi.fn().mockResolvedValue('analysis'),
}));

vi.mock('@dashboard/operations', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    sendTestNotification: vi.fn().mockResolvedValue(undefined),
    broadcastActionUpdate: vi.fn(),
    initRemediationDeps: vi.fn(),
  };
});

vi.mock('@dashboard/core/services/typed-event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(() => vi.fn()), onAny: vi.fn(() => vi.fn()), emitAsync: vi.fn() },
}));

vi.mock('@dashboard/ai', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    getIncidents: vi.fn(() => []),
    getIncident: vi.fn(() => null),
    resolveIncident: vi.fn(),
    getIncidentCount: vi.fn(() => 0),
  };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────
import { remediationRoutes } from '@dashboard/operations';
import { securityRoutes } from '@dashboard/security/routes/index.js';
import { edgeJobsRoutes } from '@dashboard/infrastructure/routes/index.js';
import { imagesRoutes, userRoutes, oidcRoutes } from '@dashboard/foundation';
import { notificationRoutes } from '@dashboard/operations';
import { incidentsRoutes, monitoringRoutes, type MonitoringRoutesOpts } from '@dashboard/ai';
import type { LLMInterface } from '@dashboard/contracts';

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { cache } from '@dashboard/core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

// ─── Suite-wide setup ────────────────────────────────────────────────────
beforeAll(async () => {
  vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getImages').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'restartContainer').mockResolvedValue(undefined);
  vi.spyOn(portainerClient, 'stopContainer').mockResolvedValue(undefined);
  vi.spyOn(portainerClient, 'startContainer').mockResolvedValue(undefined);
  vi.spyOn(portainerClient, 'checkPortainerReachable').mockResolvedValue({ reachable: true, ok: true });
  await cache.clear();
  await flushTestCache();
  setConfigForTest({
    PORTAINER_API_URL: 'http://localhost:9000',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.2',
    JWT_ALGORITHM: 'HS256',
    CACHE_ENABLED: false,
    LOGIN_RATE_LIMIT: 5,
    LLM_RATE_LIMIT_PER_MINUTE: 20,
    API_RATE_LIMIT: 1200,
  });
});

afterAll(async () => {
  resetConfig();
  await closeTestRedis();
});

// =====================================================================
//  REMEDIATION APPROVAL GATE
// =====================================================================
describe('Remediation Approval Gate', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
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
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: currentRole };
    });
    await app.register(remediationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentRole = 'admin';
    mockRemediationAction = {
      id: 'a1',
      status: 'pending',
      action_type: 'RESTART_CONTAINER',
      endpoint_id: 1,
      container_id: 'c1',
    };
  });

  it('denies execution for unapproved actions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/execute',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('must be approved');
  });

  it('allows execution for approved actions when caller is admin', async () => {
    mockRemediationAction = { ...mockRemediationAction, status: 'approved' };

    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/execute',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, actionId: 'a1', status: 'completed' });
  });
});

// =====================================================================
//  PCAP ADMIN RBAC ENFORCEMENT
// =====================================================================
describe('PCAP Admin RBAC Enforcement', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
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
      request.user = { sub: 'u1', username: 'user', sessionId: 's1', role: currentRole };
    });
    const mockLlm: LLMInterface = { isAvailable: vi.fn(), chatStream: vi.fn(), getEffectivePrompt: vi.fn(), buildInfrastructureContext: vi.fn() };
    await app.register(securityRoutes, { llm: mockLlm });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies start-capture for non-admin users', async () => {
    currentRole = 'viewer';

    const res = await app.inject({
      method: 'POST',
      url: '/api/pcap/captures',
      payload: {
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'web',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('denies list-captures for non-admin users (#1020 regression)', async () => {
    currentRole = 'viewer';

    const res = await app.inject({
      method: 'GET',
      url: '/api/pcap/captures',
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies get-capture for non-admin users (#1020 regression)', async () => {
    currentRole = 'operator';

    const res = await app.inject({
      method: 'GET',
      url: '/api/pcap/captures/c1',
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies stop/analyze/delete for non-admin users', async () => {
    currentRole = 'operator';

    const stopRes = await app.inject({
      method: 'POST',
      url: '/api/pcap/captures/c1/stop',
    });
    expect(stopRes.statusCode).toBe(403);

    const analyzeRes = await app.inject({
      method: 'POST',
      url: '/api/pcap/captures/c1/analyze',
    });
    expect(analyzeRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/pcap/captures/c1',
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it('allows admin to execute a mutating PCAP route', async () => {
    currentRole = 'admin';

    const res = await app.inject({
      method: 'POST',
      url: '/api/pcap/captures/c1/stop',
    });

    expect(res.statusCode).not.toBe(403);
  });

  // #1240 — Observed Destinations endpoint is admin-only.
  it('denies GET /api/security/observed-destinations for non-admin users (#1240)', async () => {
    currentRole = 'viewer';
    const viewerRes = await app.inject({
      method: 'GET',
      url: '/api/security/observed-destinations',
    });
    expect(viewerRes.statusCode).toBe(403);

    currentRole = 'operator';
    const operatorRes = await app.inject({
      method: 'GET',
      url: '/api/security/observed-destinations',
    });
    expect(operatorRes.statusCode).toBe(403);
  });

  it('allows admin to GET /api/security/observed-destinations (#1240)', async () => {
    currentRole = 'admin';
    const res = await app.inject({
      method: 'GET',
      url: '/api/security/observed-destinations',
    });
    // 200 if DB reachable, 5xx if not; either way, RBAC must not block it.
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });
});

// =====================================================================
//  EDGE JOBS ADMIN RBAC ENFORCEMENT
// =====================================================================
describe('Edge Jobs Admin RBAC Enforcement', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
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
      request.user = { sub: 'u1', username: 'user', sessionId: 's1', role: currentRole };
    });
    await app.register(edgeJobsRoutes);
    await app.ready();
    // Prevent real Portainer calls when RBAC passes for admin role
    vi.spyOn(portainerClient, 'createEdgeJob').mockResolvedValue({} as any);
    vi.spyOn(portainerClient, 'deleteEdgeJob').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies create/delete edge jobs for non-admin users', async () => {
    currentRole = 'viewer';

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/edge-jobs',
      payload: {
        name: 'nightly-backup',
        cronExpression: '0 0 * * *',
        recurring: true,
        endpoints: [1],
        fileContent: '#!/bin/sh\necho test',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/edge-jobs/1',
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it('allows admin users to reach mutating edge-job handlers', async () => {
    currentRole = 'admin';

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/edge-jobs',
      payload: {
        name: 'nightly-backup',
        cronExpression: '0 0 * * *',
        recurring: true,
        endpoints: [1],
        fileContent: '#!/bin/sh\necho test',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createRes.statusCode).not.toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/edge-jobs/1',
    });
    expect(deleteRes.statusCode).not.toBe(403);
  });
});

// =====================================================================
//  OPERATIONAL TRIGGERS ADMIN RBAC ENFORCEMENT
// =====================================================================
describe('Operational Triggers Admin RBAC Enforcement', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
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
      request.user = { sub: 'u1', username: 'user', sessionId: 's1', role: currentRole };
    });
    await app.register(imagesRoutes);
    await app.register(notificationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies POST /api/images/staleness/check for viewer', async () => {
    currentRole = 'viewer';

    const res = await app.inject({
      method: 'POST',
      url: '/api/images/staleness/check',
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows POST /api/images/staleness/check for admin', async () => {
    currentRole = 'admin';

    const res = await app.inject({
      method: 'POST',
      url: '/api/images/staleness/check',
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('denies POST /api/notifications/test for operator', async () => {
    currentRole = 'operator';

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/test',
      payload: { channel: 'teams' },
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows POST /api/notifications/test for admin', async () => {
    currentRole = 'admin';

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/test',
      payload: { channel: 'teams' },
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).not.toBe(403);
  });
});

// =====================================================================
//  LLM OBSERVABILITY ADMIN RBAC (issue #1029, CWE-862)
// =====================================================================
// Source-level guard: the routes file must have requireRole('admin').
describe('LLM Observability Admin RBAC Enforcement', () => {
  it('GET /api/llm/traces route source must include requireRole admin', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'ai-intelligence', 'src', 'routes', 'llm-observability.ts');
    const content = readFileSync(file, 'utf8');

    const tracesBlock = content.match(/get\s*\(\s*'\/api\/llm\/traces'[\s\S]*?preHandler:\s*\[([^\]]+)\]/);
    expect(tracesBlock).not.toBeNull();
    expect(tracesBlock![1]).toContain("requireRole('admin')");
  });

  it('GET /api/llm/stats route source must include requireRole admin', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'ai-intelligence', 'src', 'routes', 'llm-observability.ts');
    const content = readFileSync(file, 'utf8');

    const statsBlock = content.match(/get\s*\(\s*'\/api\/llm\/stats'[\s\S]*?preHandler:\s*\[([^\]]+)\]/);
    expect(statsBlock).not.toBeNull();
    expect(statsBlock![1]).toContain("requireRole('admin')");
  });
});

// =====================================================================
//  INCIDENT RESOLVE ADMIN RBAC ENFORCEMENT (issue #1028, CWE-862)
// =====================================================================
describe('Incident Resolve Admin RBAC Enforcement', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
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
      request.user = { sub: 'u1', username: 'user', sessionId: 's1', role: currentRole };
    });
    await app.register(incidentsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies POST /api/incidents/:id/resolve for viewer', async () => {
    currentRole = 'viewer';

    const res = await app.inject({
      method: 'POST',
      url: '/api/incidents/inc-1/resolve',
    });

    expect(res.statusCode).toBe(403);
  });

  it('denies POST /api/incidents/:id/resolve for operator', async () => {
    currentRole = 'operator';

    const res = await app.inject({
      method: 'POST',
      url: '/api/incidents/inc-1/resolve',
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows POST /api/incidents/:id/resolve for admin', async () => {
    currentRole = 'admin';

    const res = await app.inject({
      method: 'POST',
      url: '/api/incidents/inc-1/resolve',
    });

    expect(res.statusCode).not.toBe(403);
  });
});

// =====================================================================
//  USERS ROUTE — assertUser DEFENSIVE FAIL-LOUD (issue #1110)
// =====================================================================
//
// `users.ts` replaced `request.user!` non-null assertions with the typed
// `assertUser` helper. Under correct configuration the helper is a no-op
// — preHandler `[fastify.authenticate, fastify.requireRole('admin')]`
// guarantees `request.user` is populated before the handler body runs.
//
// These tests verify the defensive branch: if the `authenticate`
// preHandler is removed/misconfigured and never sets `request.user`, the
// helper must throw (producing a 5xx) rather than silently letting the
// audit log write `undefined` for `user_id` / `username`. This is the
// "loud failure beats silent admin auth bypass" guarantee.
describe('Users route — assertUser defensive fail-loud (issue #1110)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Intentionally misconfigured: `authenticate` does NOT set `request.user`.
    // This simulates a future refactor that accidentally removes the real
    // preHandler chain. `assertUser` must catch this and throw rather than
    // letting the handler audit-log `undefined`.
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);

    await app.register(userRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/users fails loudly (5xx) when authenticate preHandler does not set request.user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'newuser', password: 'password123', role: 'viewer' },
      headers: { 'content-type': 'application/json' },
    });

    // Helper threw → Fastify converts to 500. Anything in the 5xx range
    // proves the defensive branch fired (vs. a silent 200/201 with a
    // `user_id: undefined` audit log entry, which would be the bug).
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.statusCode).toBeLessThan(600);
  });

  // Re-enabled in #1188 — splitting this describe into its own file gives it a
  // clean module state, free of the `vi.resetModules()` interactions that
  // forced this case to be skipped on the monolithic file.
  it('PATCH /api/users/:id fails loudly (5xx) when authenticate preHandler does not set request.user', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/some-id',
      payload: { username: 'renamed' },
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.statusCode).toBeLessThan(600);
  });

  it('DELETE /api/users/:id fails loudly (5xx) when authenticate preHandler does not set request.user', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/users/some-id',
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.statusCode).toBeLessThan(600);
  });
});

// =====================================================================
//  TRACE INGEST-STATS ADMIN RBAC ENFORCEMENT (issue #1242)
// =====================================================================
// Per-source sampler counters can reveal which services/namespaces exist on
// the box, so the endpoint must require the admin role at the route source.
describe('Trace ingest-stats Admin RBAC Enforcement', () => {
  it('GET /api/traces/ingest-stats route source must include requireRole admin', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'observability', 'src', 'routes', 'traces.ts');
    const content = readFileSync(file, 'utf8');

    const statsBlock = content.match(
      /get\s*\(\s*'\/api\/traces\/ingest-stats'[\s\S]*?preHandler:\s*\[([^\]]+)\]/,
    );
    expect(statsBlock).not.toBeNull();
    expect(statsBlock![1]).toContain("requireRole('admin')");
  });
});

// =====================================================================
//  OIDC DISCOVERED-GROUPS ADMIN RBAC ENFORCEMENT (issue #1281)
// =====================================================================
// The `/api/auth/oidc/discovered-groups` endpoint backs the searchable
// group-to-role mapping editor and exposes group identifiers observed from
// past OIDC logins. The list is sensitive directory information, so the
// route must require the admin role — viewer/operator callers must get
// 403, and anonymous callers must be blocked by `authenticate`.
describe('OIDC Discovered Groups Admin RBAC Enforcement', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin' | null;

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // `authenticate` rejects anonymous callers (no role) with 401, matching
    // the production decorator behaviour.
    app.decorate('authenticate', async (request, reply) => {
      if (currentRole === null) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      if (currentRole !== null) {
        request.user = { sub: 'u1', username: 'user', sessionId: 's1', role: currentRole };
      }
    });
    await app.register(oidcRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies GET /api/auth/oidc/discovered-groups for anonymous callers', async () => {
    currentRole = null;

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/discovered-groups',
    });

    expect(res.statusCode).toBe(401);
  });

  it('denies GET /api/auth/oidc/discovered-groups for viewer role', async () => {
    currentRole = 'viewer';

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/discovered-groups',
    });

    expect(res.statusCode).toBe(403);
  });

  it('denies GET /api/auth/oidc/discovered-groups for operator role', async () => {
    currentRole = 'operator';

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/discovered-groups',
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows GET /api/auth/oidc/discovered-groups for admin role', async () => {
    currentRole = 'admin';

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/discovered-groups',
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// =====================================================================
//  MONITORING SENSITIVITY PRESET (issue #1297)
// =====================================================================
// The per-user Sensitivity preset is a personal preference: every
// authenticated user can read and update their own value (viewer +
// operator + admin all allowed). Anonymous callers must be rejected.
// This guards against accidental promotion to an admin-only route in a
// future refactor (it must NOT be gated by requireRole('admin')).
describe('Monitoring Sensitivity Preset RBAC (#1297)', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin' | null;
  // Note: `@dashboard/core/db/app-db-router.js` is already mocked at the
  // top of this file to return a no-op DB. That's enough for the routes
  // to succeed without touching real Postgres — `getUserPreset` falls
  // back to 'default' on a null row and `setUserPreset` is a no-op write.

  beforeAll(async () => {
    currentRole = 'viewer';
    const { monitoringRoutes } = await import('@dashboard/ai');

    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request, reply) => {
      if (currentRole === null) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      if (currentRole !== null) {
        request.user = { sub: 'u-pref', username: 'user', sessionId: 's-pref', role: currentRole };
      }
    });

    await app.register(monitoringRoutes, {
      getSecurityAudit: vi.fn().mockResolvedValue([]),
      getSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
      setSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
      defaultSecurityAuditIgnorePatterns: [],
      securityAuditIgnoreKey: 'security_audit_ignore',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous GET /api/monitoring/sensitivity (authenticate enforced)', async () => {
    currentRole = null;
    const res = await app.inject({ method: 'GET', url: '/api/monitoring/sensitivity' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects anonymous PUT /api/monitoring/sensitivity (authenticate enforced)', async () => {
    currentRole = null;
    const res = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'high' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows GET for viewer role (per-user preference, no admin gate)', async () => {
    currentRole = 'viewer';
    const res = await app.inject({ method: 'GET', url: '/api/monitoring/sensitivity' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ preset: 'default' });
  });

  it('allows PUT for viewer role (per-user preference, no admin gate)', async () => {
    // The mutating PUT MUST be reachable by a viewer (issue #1297 AC: PUT
    // does NOT require admin — it's a personal preference). If a future
    // refactor accidentally gates this with `requireRole('admin')`, this
    // assertion fails immediately.
    currentRole = 'viewer';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'high' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ preset: 'high' });
  });

  it('allows GET for operator role (per-user preference, no admin gate)', async () => {
    currentRole = 'operator';
    const res = await app.inject({ method: 'GET', url: '/api/monitoring/sensitivity' });
    expect(res.statusCode).toBe(200);
  });

  it('PUT rejects invalid preset values with 400', async () => {
    currentRole = 'viewer';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/sensitivity',
      payload: { preset: 'EXTREME' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// =====================================================================
//  ANOMALY FEEDBACK ROUTES — AUTH + ADMIN SCOPE GATING (issue #1298)
// =====================================================================
//
// POST /api/monitoring/anomaly-feedback must reject anonymous callers
// (any authenticated user — viewer/operator/admin — can file feedback
// on their own behalf, but unauthenticated requests must 401).
//
// GET /api/monitoring/anomaly-feedback/rates must reject anonymous
// callers and is caller-scoped by default. The scope=fleet widening
// is admin-only: viewer/operator passing scope=fleet must be silently
// downgraded to caller scope (no fleet data may leak).
describe('Anomaly Feedback Routes — Auth + Admin Scope Gating (issue #1298)', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin' | null;

  const monitoringOpts: MonitoringRoutesOpts = {
    getSecurityAudit: vi.fn().mockResolvedValue([]),
    getSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
    setSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
    defaultSecurityAuditIgnorePatterns: [],
    securityAuditIgnoreKey: 'test-ignore-key',
  };

  beforeAll(async () => {
    currentRole = 'operator';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // `authenticate` rejects anonymous callers (no role) with 401, matching
    // the production decorator behaviour.
    app.decorate('authenticate', async (request, reply) => {
      if (currentRole === null) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      if (currentRole !== null) {
        request.user = { sub: 'u1', username: 'user', sessionId: 's1', role: currentRole };
      }
    });
    await app.register(monitoringRoutes, monitoringOpts);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies POST /api/monitoring/anomaly-feedback for anonymous callers', async () => {
    currentRole = null;
    const res = await app.inject({
      method: 'POST',
      url: '/api/monitoring/anomaly-feedback',
      payload: { anomalyId: 'a-1' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('denies GET /api/monitoring/anomaly-feedback/rates for anonymous callers', async () => {
    currentRole = null;
    const res = await app.inject({
      method: 'GET',
      url: '/api/monitoring/anomaly-feedback/rates',
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows POST for any authenticated role (viewer/operator/admin) — RBAC contract', async () => {
    // POST must NOT require admin — any authenticated user can file
    // feedback on their own behalf. We assert "not 401, not 403" rather
    // than 200 because the mocked DB will return its own error code.
    for (const role of ['viewer', 'operator', 'admin'] as const) {
      currentRole = role;
      const res = await app.inject({
        method: 'POST',
        url: '/api/monitoring/anomaly-feedback',
        payload: { anomalyId: 'a-1' },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    }
  });

  it('GET /rates reaches the handler for any authenticated role', async () => {
    // The handler itself enforces the scope-widening guard
    // (viewer/operator with ?scope=fleet must NOT receive fleet data).
    // RBAC layer must not reject viewer/operator here — they're allowed
    // to query their own rate scope by default.
    for (const role of ['viewer', 'operator', 'admin'] as const) {
      currentRole = role;
      const res = await app.inject({
        method: 'GET',
        url: '/api/monitoring/anomaly-feedback/rates',
      });
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    }
  });

  // Source-level guard: the routes file must use `fastify.authenticate`
  // on both routes. If a future refactor accidentally drops the
  // preHandler, this assertion fires.
  it('monitoring routes source must include fastify.authenticate on the anomaly-feedback routes', () => {
    const file = path.resolve(
      process.cwd(),
      '..',
      'packages',
      'ai-intelligence',
      'src',
      'routes',
      'monitoring.ts',
    );
    const content = readFileSync(file, 'utf8');

    const postBlock = content.match(
      /post\s*\(\s*'\/api\/monitoring\/anomaly-feedback'[\s\S]*?preHandler:\s*\[([^\]]+)\]/,
    );
    expect(postBlock).not.toBeNull();
    expect(postBlock![1]).toContain('fastify.authenticate');

    const getBlock = content.match(
      /get\s*\(\s*'\/api\/monitoring\/anomaly-feedback\/rates'[\s\S]*?preHandler:\s*\[([^\]]+)\]/,
    );
    expect(getBlock).not.toBeNull();
    expect(getBlock![1]).toContain('fastify.authenticate');
  });

  // Source-level guard: the rates handler must distinguish admin from
  // non-admin to enforce the scope-widening contract.
  it('rates handler source must branch on role === \'admin\' to enforce scope-widening', () => {
    const file = path.resolve(
      process.cwd(),
      '..',
      'packages',
      'ai-intelligence',
      'src',
      'routes',
      'monitoring.ts',
    );
    const content = readFileSync(file, 'utf8');

    // The handler resolves the calling user's role and only widens to
    // fleet when role === 'admin'. Match either the explicit comparison
    // or a derived `isAdmin` boolean.
    expect(content).toMatch(/role\s*===\s*'admin'/);
  });
});
