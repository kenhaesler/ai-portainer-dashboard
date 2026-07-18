/**
 * Field-presence test for the Harbor vulnerabilities response schemas (#1545).
 *
 * Adds `response: { 200: ... }` to GET /api/harbor/vulnerabilities and
 * /api/harbor/vulnerabilities/summary. fastify-type-provider-zod prunes any
 * field not enumerated, so this test asserts every field the frontend consumer
 * (use-harbor-vulnerabilities.ts) reads survives serialization. The store is
 * mocked (the boundary); the DB is not under test here.
 */
import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import type { z } from 'zod/v4';
import type { VulnerabilityRecord, VulnerabilitySummary, ExceptionRecord, SyncStatusRecord } from '../services/harbor-vulnerability-store.js';

vi.mock('../services/harbor-vulnerability-store.js', () => ({
  getVulnerabilities: vi.fn(),
  getVulnerabilitySummary: vi.fn(),
  getVulnerabilitiesCount: vi.fn(),
  classifySyncStatus: vi.fn((record) => ({ lastSync: record, truncated: false, syncWarning: null })),
  getLatestSyncStatus: vi.fn(),
  getExceptions: vi.fn(),
  createException: vi.fn(),
  deactivateException: vi.fn(),
}));
vi.mock('../services/harbor-client.js', () => ({
  isHarborConfiguredAsync: vi.fn().mockResolvedValue(true),
  testConnection: vi.fn(),
  getSecuritySummary: vi.fn(),
}));
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveHarborConfig: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('../services/harbor-sync.js', () => ({ runFullSync: vi.fn(), getIsSyncing: vi.fn() }));
vi.mock('@dashboard/core/services/audit-logger.js', () => ({ writeAuditLog: vi.fn() }));

import * as vulnStore from '../services/harbor-vulnerability-store.js';
import * as harborClient from '../services/harbor-client.js';
import { getEffectiveHarborConfig } from '@dashboard/core/services/settings-store.js';
import { runFullSync, getIsSyncing } from '../services/harbor-sync.js';
import {
  harborVulnerabilityRoutes,
  HarborVulnerabilityRecordSchema,
  HarborVulnerabilitySummarySchema,
  HarborSyncStatusRecordSchema,
  HarborExceptionRecordSchema,
} from '../routes/harbor-vulnerabilities.js';

const RECORD = {
  id: 1,
  cve_id: 'CVE-2024-1',
  severity: 'Critical',
  cvss_v3_score: 9.8,
  package: 'openssl',
  version: '1.1',
  fixed_version: null,
  status: null,
  description: null,
  links: null,
  project_id: 2,
  repository_name: 'lib/app',
  digest: 'sha256:x',
  tags: null,
  in_use: true,
  matching_containers: null,
  synced_at: '2026-07-13T00:00:00.000Z',
};
const SUMMARY = {
  total: 1,
  critical: 1,
  high: 0,
  medium: 0,
  low: 0,
  in_use_total: 1,
  in_use_critical: 1,
  fixable: 0,
  excepted: 0,
};

const SYNC_STATUS = {
  id: 7,
  sync_type: 'full',
  status: 'completed',
  vulnerabilities_synced: 500,
  in_use_matched: 12,
  error_message: null,
  started_at: '2026-07-13T00:00:00.000Z',
  completed_at: '2026-07-13T00:01:00.000Z',
};

const EXCEPTION = {
  id: 4,
  cve_id: 'CVE-2024-2',
  scope: 'global',
  scope_ref: null,
  justification: 'Not exploitable in this deployment',
  created_by: 'admin',
  approved_by: null,
  expires_at: null,
  is_active: true,
  synced_to_harbor: false,
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
};

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  return app;
}

describe('GET /api/harbor/vulnerabilities response schema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves every VulnerabilityRecord + summary field the frontend reads, and prunes internal fields', async () => {
    // Inject synthetic internal fields the store might one day return; the
    // response schema must prune them (proves the schema is active).
    vi.mocked(vulnStore.getVulnerabilities).mockResolvedValue([{ ...RECORD, _internal_secret: 'leak' }] as never);
    vi.mocked(vulnStore.getVulnerabilitySummary).mockResolvedValue({ ...SUMMARY, _internal: 1 } as never);
    vi.mocked(vulnStore.getVulnerabilitiesCount).mockResolvedValue(1 as never);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/harbor/vulnerabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 1, limit: 200, offset: 0 });
    // Exact-equality asserts both presence of every frontend field AND pruning
    // of the synthetic internal fields.
    expect(body.vulnerabilities[0]).toEqual(RECORD);
    expect(body.summary).toEqual(SUMMARY);
    await app.close();
  });

  it('summary route returns all 9 counters and prunes internal fields', async () => {
    vi.mocked(vulnStore.getVulnerabilitySummary).mockResolvedValue({ ...SUMMARY, _internal: 1 } as never);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/harbor/vulnerabilities/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SUMMARY);
    await app.close();
  });
});

describe('GET /api/harbor/status response schema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('not-configured branch returns exactly { configured: false, connected: false, lastSync: null }', async () => {
    vi.mocked(harborClient.isHarborConfiguredAsync).mockResolvedValue(false);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/harbor/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, connected: false, lastSync: null });
    await app.close();
  });

  it('configured branch preserves lastSync fields and prunes internal fields', async () => {
    vi.mocked(harborClient.isHarborConfiguredAsync).mockResolvedValue(true);
    vi.mocked(harborClient.testConnection).mockResolvedValue({ ok: true });
    vi.mocked(vulnStore.getLatestSyncStatus).mockResolvedValue({ ...SYNC_STATUS, _internal: 1 } as never);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/harbor/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.truncated).toBe(false);
    expect(body.syncWarning).toBeNull();
    expect(body.lastSync).toEqual(SYNC_STATUS);
    await app.close();
  });
});

describe('GET /api/harbor/enabled response schema', () => {
  it('returns { enabled }', async () => {
    vi.mocked(getEffectiveHarborConfig).mockResolvedValueOnce({
      enabled: true,
      apiUrl: 'https://harbor.example.com',
      robotName: 'robot$ci',
      robotSecret: 'secret',
    } as never);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/harbor/enabled' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
    await app.close();
  });
});

describe('POST /api/harbor/sync response schema', () => {
  it('returns { message, status } when a sync is started', async () => {
    vi.mocked(harborClient.isHarborConfiguredAsync).mockResolvedValue(true);
    vi.mocked(getIsSyncing).mockReturnValue(false);
    vi.mocked(runFullSync).mockResolvedValue(undefined);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/harbor/sync' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'Sync started', status: 'running' });
    await app.close();
  });
});

describe('/api/harbor/exceptions response schemas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET preserves every ExceptionRecord field and prunes internal fields', async () => {
    vi.mocked(vulnStore.getExceptions).mockResolvedValue([{ ...EXCEPTION, _internal: 1 }] as never);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/harbor/exceptions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([EXCEPTION]);
    await app.close();
  });

  it('POST preserves every ExceptionRecord field and prunes internal fields', async () => {
    vi.mocked(vulnStore.createException).mockResolvedValue({ ...EXCEPTION, _internal: 1 } as never);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/harbor/exceptions',
      payload: { cve_id: EXCEPTION.cve_id, justification: EXCEPTION.justification },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(EXCEPTION);
    await app.close();
  });

  it('POST tolerates a null return (store re-SELECT miss) without 500ing', async () => {
    vi.mocked(vulnStore.createException).mockResolvedValue(null);

    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/harbor/exceptions',
      payload: { cve_id: 'CVE-2024-3', justification: 'Justification text here' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });
});

// Compile-time drift guard (#1545): the response schemas are hand-written to
// mirror the store's TS interfaces. These type assertions fail `tsc` if the two
// ever diverge in either direction — a field added/removed/retyped on either
// side breaks the build here, so the manual mirror can't silently rot.
describe('harbor response schemas stay in sync with the store interfaces', () => {
  it('record schema matches VulnerabilityRecord', () => {
    expectTypeOf<z.infer<typeof HarborVulnerabilityRecordSchema>>().toEqualTypeOf<VulnerabilityRecord>();
  });

  it('summary schema matches VulnerabilitySummary', () => {
    expectTypeOf<z.infer<typeof HarborVulnerabilitySummarySchema>>().toEqualTypeOf<VulnerabilitySummary>();
  });

  it('sync status schema matches SyncStatusRecord', () => {
    expectTypeOf<z.infer<typeof HarborSyncStatusRecordSchema>>().toEqualTypeOf<SyncStatusRecord>();
  });

  it('exception schema matches ExceptionRecord', () => {
    expectTypeOf<z.infer<typeof HarborExceptionRecordSchema>>().toEqualTypeOf<ExceptionRecord>();
  });
});
