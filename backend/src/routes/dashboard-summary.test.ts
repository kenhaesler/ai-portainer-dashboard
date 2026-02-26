import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from './dashboard.js';

const mockGetSecurityAudit = vi.fn();
const mockBuildSecurityAuditSummary = vi.fn();

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());

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

vi.mock('../modules/security/services/security-audit.js', () => ({
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

    mockGetEndpoints.mockResolvedValue([{
      Id: 1, Name: 'ep-1', Type: 1, URL: 'http://ep-1', Status: 1,
      Snapshots: [{ RunningContainerCount: 2, StoppedContainerCount: 1, HealthyContainerCount: 2, UnhealthyContainerCount: 1, StackCount: 1, TotalCPU: 0, TotalMemory: 0 }],
    }] as any);

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
