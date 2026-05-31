import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from '@dashboard/foundation';

const mockGetSecurityAudit = vi.fn();
const mockBuildSecurityAuditSummary = vi.fn();
const mockGetLatestKpiSnapshot = vi.fn();

// Drive live container counts deterministically without hitting Portainer's
// /docker/info proxy. The config mock keeps the live-query feature enabled.
vi.mock('@dashboard/core/portainer/edge-live-query.js', () => ({ fetchLiveDockerInfo: vi.fn() }));
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveEdgeLiveQueryConfig: vi.fn().mockResolvedValue({ enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000 }),
}));
// Source /summary healthy/unhealthy from the latest KPI snapshot.
vi.mock('@dashboard/observability', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getLatestKpiSnapshot: (...a: unknown[]) => mockGetLatestKpiSnapshot(...a),
}));

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());

import { fetchLiveDockerInfo } from '@dashboard/core/portainer/edge-live-query.js';
const mockLiveFetch = vi.mocked(fetchLiveDockerInfo);
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { cache, waitForInFlight } from '@dashboard/core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetContainers: any;

afterEach(async () => {
  await waitForInFlight();
});

afterAll(async () => {
  await closeTestRedis();
});

vi.mock('@dashboard/security', () => ({
  getSecurityAudit: (...args: unknown[]) => mockGetSecurityAudit(...args),
  buildSecurityAuditSummary: (...args: unknown[]) => mockBuildSecurityAuditSummary(...args),
}));

describe('Dashboard Summary Route', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints');
    mockGetContainers = vi.spyOn(portainerClient, 'getContainers');
    // Default: no stacks, no live counts, no KPI snapshot — tests opt in per case.
    vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([] as never);
    mockLiveFetch.mockReset();
    mockLiveFetch.mockResolvedValue(null);
    mockGetLatestKpiSnapshot.mockReset();
    mockGetLatestKpiSnapshot.mockResolvedValue(null);
    mockBuildSecurityAuditSummary.mockReturnValue({ totalAudited: 0, flagged: 0, ignored: 0 });
    mockGetSecurityAudit.mockResolvedValue([]);
  });

  it('returns 200 with KPIs when container fetches would fail (containers no longer fetched in summary)', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    // Snapshots[] is ignored now — counts come from the live /docker/info mock.
    mockGetEndpoints.mockResolvedValue([{
      Id: 1, Name: 'ep-1', Type: 1, URL: 'http://ep-1', Status: 1,
    }] as any);
    mockLiveFetch.mockResolvedValue({ containers: 3, containersRunning: 2, containersStopped: 1, ncpu: 0, memTotal: 0, fetchedAt: Date.now() });
    vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([{ EndpointId: 1 }] as never);
    // healthy/unhealthy for /summary come from the latest KPI snapshot.
    mockGetLatestKpiSnapshot.mockResolvedValue({ healthy: 2, unhealthy: 1 });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kpis).toMatchObject({
      endpoints: 1,
      endpointsUp: 1,
      endpointsDown: 0,
      running: 2,
      stopped: 1,
      healthy: 2,
      unhealthy: 1,
      total: 3,
      stacks: 1,
    });
    // recentContainers removed from summary (#801)
    expect(body.recentContainers).toBeUndefined();
    // endpoints array removed from summary to reduce payload (#544)
    expect(body.endpoints).toBeUndefined();

    await app.close();
  });

  it('runs security audit concurrently with endpoint fetch (#375)', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    const callOrder: string[] = [];

    // getSecurityAudit is kicked off but won't resolve until the next microtask.
    // getEndpoints adds artificial latency so the handler must await it.
    // If security audit were started *after* awaiting endpoints, we'd see
    // 'getEndpoints:resolved' before 'getSecurityAudit:start' — the assertion
    // below catches that ordering violation.
    mockGetEndpoints.mockImplementation(() => {
      callOrder.push('getEndpoints:start');
      return new Promise((resolve) => {
        setTimeout(() => {
          callOrder.push('getEndpoints:resolved');
          resolve([{
            Id: 1, Name: 'ep-1', Type: 1, URL: 'http://ep-1', Status: 1,
          }]);
        }, 10);
      });
    });
    mockGetSecurityAudit.mockImplementation(() => {
      callOrder.push('getSecurityAudit:start');
      return Promise.resolve([]);
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });

    expect(res.statusCode).toBe(200);
    // Security audit must be initiated before the endpoint fetch resolves,
    // proving they run concurrently rather than sequentially.
    const auditIdx = callOrder.indexOf('getSecurityAudit:start');
    const endpointsResolvedIdx = callOrder.indexOf('getEndpoints:resolved');
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(endpointsResolvedIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeLessThan(endpointsResolvedIdx);

    await app.close();
  });

  it('returns fallback security data when audit fails (#375)', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    mockGetEndpoints.mockResolvedValue([{
      Id: 1, Name: 'ep-1', Type: 1, URL: 'http://ep-1', Status: 1,
    }]);
    mockGetSecurityAudit.mockRejectedValue(new Error('DB unavailable'));

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.security).toEqual({ totalAudited: 0, flagged: 0, ignored: 0 });

    await app.close();
  });

  it('returns 502 when endpoint list cannot be fetched', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    mockGetEndpoints.mockRejectedValue(new Error('upstream unavailable'));

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('Unable to connect to Portainer');

    await app.close();
  });
});
