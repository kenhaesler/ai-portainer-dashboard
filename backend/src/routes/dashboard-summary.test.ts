import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { dashboardRoutes } from './dashboard.js';

const mockGetEndpoints = vi.fn();
const mockGetContainers = vi.fn();
const mockNormalizeEndpoint = vi.fn();
const mockNormalizeContainer = vi.fn();
const mockGetSecurityAudit = vi.fn();
const mockBuildSecurityAuditSummary = vi.fn();
const mockCachedFetchSWR = vi.fn();

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: (...args: unknown[]) => mockGetEndpoints(...args),
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetchSWR: (...args: unknown[]) => mockCachedFetchSWR(...args),
  getCacheKey: (...parts: unknown[]) => parts.join(':'),
  TTL: {
    ENDPOINTS: 30_000,
    CONTAINERS: 30_000,
  },
}));

vi.mock('../services/portainer-normalizers.js', () => ({
  normalizeEndpoint: (...args: unknown[]) => mockNormalizeEndpoint(...args),
  normalizeContainer: (...args: unknown[]) => mockNormalizeContainer(...args),
}));

vi.mock('../services/security-audit.js', () => ({
  getSecurityAudit: (...args: unknown[]) => mockGetSecurityAudit(...args),
  buildSecurityAuditSummary: (...args: unknown[]) => mockBuildSecurityAuditSummary(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Dashboard Summary Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCachedFetchSWR.mockImplementation(async (_key, _ttl, fetcher: () => Promise<unknown>) => fetcher());
    mockBuildSecurityAuditSummary.mockReturnValue({ totalAudited: 0, flagged: 0, ignored: 0 });
    mockGetSecurityAudit.mockResolvedValue([]);
  });

  it('returns 200 with empty recentContainers when container fetches fail', async () => {
    const app = Fastify();
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    mockGetEndpoints.mockResolvedValue([{ id: 1, name: 'ep-1' }]);
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
    expect(body.endpoints).toHaveLength(1);

    await app.close();
  });

  it('returns 502 when endpoint list cannot be fetched', async () => {
    const app = Fastify();
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
