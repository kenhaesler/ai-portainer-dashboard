import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { stacksRoutes } from './stacks.js';

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: vi.fn(),
  getStacks: vi.fn(),
  getStack: vi.fn(),
  getStacksByEndpoint: vi.fn(),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetchSWR: vi.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  getCacheKey: vi.fn((...args: (string | number)[]) => args.join(':')),
  TTL: { STACKS: 60, ENDPOINTS: 900 },
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import * as portainer from '../services/portainer-client.js';

const mockGetEndpoints = vi.mocked(portainer.getEndpoints);
const mockGetStack = vi.mocked(portainer.getStack);
const mockGetStacksByEndpoint = vi.mocked(portainer.getStacksByEndpoint);

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(stacksRoutes);
  return app;
}

const fakeEndpoint = (id: number, name: string, status = 1) => ({
  Id: id,
  Name: name,
  Type: 1,
  URL: 'tcp://10.0.0.1:9001',
  Status: status,
  Snapshots: [],
  TagIds: [],
});

const fakeEdgeEndpoint = (id: number, name: string, lastCheckIn: number) => ({
  Id: id,
  Name: name,
  Type: 4,
  URL: 'tcp://10.0.0.2:9001',
  Status: 2, // Portainer reports "down"
  Snapshots: [],
  TagIds: [],
  EdgeID: `edge-${id}`,
  LastCheckInDate: lastCheckIn,
  EdgeCheckinInterval: 5,
});

const fakeStack = (id: number, name: string, endpointId = 1) => ({
  Id: id,
  Name: name,
  Type: 1,
  EndpointId: endpointId,
  Status: 1,
  Env: [],
});

describe('stacks routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stacks from all up endpoints', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'local'),
      fakeEndpoint(2, 'remote'),
    ] as any);
    mockGetStacksByEndpoint
      .mockResolvedValueOnce([fakeStack(1, 'web-app', 1)] as any)
      .mockResolvedValueOnce([fakeStack(2, 'api-app', 2)] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body.map((s: any) => s.name)).toEqual(['web-app', 'api-app']);
  });

  it('deduplicates stacks returned by multiple endpoints', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'local'),
      fakeEndpoint(2, 'remote'),
    ] as any);
    // Same stack ID returned by both endpoints
    mockGetStacksByEndpoint
      .mockResolvedValueOnce([fakeStack(1, 'shared-stack', 1)] as any)
      .mockResolvedValueOnce([fakeStack(1, 'shared-stack', 1)] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
  });

  it('includes stacks from Edge endpoints that checked in recently', async () => {
    const recentCheckIn = Math.floor(Date.now() / 1000) - 10; // 10s ago
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'local'),
      fakeEdgeEndpoint(2, 'edge-node', recentCheckIn),
    ] as any);
    mockGetStacksByEndpoint
      .mockResolvedValueOnce([fakeStack(1, 'local-stack', 1)] as any)
      .mockResolvedValueOnce([fakeStack(2, 'edge-stack', 2)] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body.map((s: any) => s.name)).toContain('edge-stack');
  });

  it('skips down endpoints without error', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'down-env', 2),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(0);
    expect(mockGetStacksByEndpoint).not.toHaveBeenCalled();
  });

  it('returns 502 when endpoint fetch fails', async () => {
    mockGetEndpoints.mockRejectedValue(new Error('ECONNREFUSED'));

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Unable to connect to Portainer');
  });

  it('returns stack details by id', async () => {
    mockGetStack.mockResolvedValue(fakeStack(1, 'web-app') as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks/1' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('web-app');
  });

  it('returns 502 when getStack fails', async () => {
    mockGetStack.mockRejectedValue(new Error('Stack not found'));

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks/999' });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unable to fetch stack details from Portainer');
  });
});
