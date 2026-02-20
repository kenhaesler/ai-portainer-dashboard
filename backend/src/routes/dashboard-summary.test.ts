import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from './dashboard.js';

const mockNormalizeEndpoint = vi.fn();
const mockNormalizeContainer = vi.fn();
const mockGetSecurityAudit = vi.fn();
const mockBuildSecurityAuditSummary = vi.fn();

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../services/portainer-client.js', async (importOriginal) => await importOriginal());

import * as portainerClient from '../services/portainer-client.js';
import { cache, waitForInFlight } from '../services/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetContainers: any;

afterEach(async () => {
  await waitForInFlight();
});

afterAll(async () => {
  await closeTestRedis();
});

// Kept: normalizers mock — provides deterministic normalization for test assertions
vi.mock('../services/portainer-normalizers.js', () => ({
  normalizeEndpoint: (...args: unknown[]) => mockNormalizeEndpoint(...args),
  normalizeContainer: (...args: unknown[]) => mockNormalizeContainer(...args),
}));

vi.mock('../services/security-audit.js', () => ({
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

  it('returns 200 with empty recentContainers when container fetches fail', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    mockGetEndpoints.mockResolvedValue([{ id: 1, name: 'ep-1' }] as any);
    mockNormalizeEndpoint.mockReturnValue({
      id: 1,
      name: 'ep-1',
      type: 1,
      url: 'http://ep-1',
      status: 'up',
      containersRunning: 2,
      containersStopped: 1,
      containersHealthy: 2,
      containersUnhealthy: 1,
      totalContainers: 3,
      stackCount: 1,
      totalCpu: 0,
      totalMemory: 0,
      isEdge: false,
    });
    mockGetContainers.mockRejectedValue(new Error('portainer timeout'));

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
    expect(body.recentContainers).toEqual([]);
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
