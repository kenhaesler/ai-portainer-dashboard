/**
 * Field-presence test for the Harbor vulnerabilities response schemas (#1545).
 *
 * Adds `response: { 200: ... }` to GET /api/harbor/vulnerabilities and
 * /api/harbor/vulnerabilities/summary. fastify-type-provider-zod prunes any
 * field not enumerated, so this test asserts every field the frontend consumer
 * (use-harbor-vulnerabilities.ts) reads survives serialization. The store is
 * mocked (the boundary); the DB is not under test here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

vi.mock('../services/harbor-vulnerability-store.js', () => ({
  getVulnerabilities: vi.fn(),
  getVulnerabilitySummary: vi.fn(),
  getVulnerabilitiesCount: vi.fn(),
  classifySyncStatus: vi.fn(),
  getLatestSyncStatus: vi.fn(),
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

import * as vulnStore from '../services/harbor-vulnerability-store.js';
import { harborVulnerabilityRoutes } from '../routes/harbor-vulnerabilities.js';

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
