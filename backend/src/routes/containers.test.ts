import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { containersRoutes } from './containers.js';

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: vi.fn(),
  getContainers: vi.fn(),
  getContainer: vi.fn(),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetchSWR: vi.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  getCacheKey: vi.fn((...args: string[]) => args.join(':')),
  TTL: { ENDPOINTS: 30, CONTAINERS: 15, STATS: 60 },
}));

import * as portainer from '../services/portainer-client.js';
import { cachedFetchSWR, getCacheKey } from '../services/portainer-cache.js';

const mockGetEndpoints = vi.mocked(portainer.getEndpoints);
const mockGetContainers = vi.mocked(portainer.getContainers);
const mockGetContainer = vi.mocked(portainer.getContainer);
const mockCachedFetchSWR = vi.mocked(cachedFetchSWR);
const mockGetCacheKey = vi.mocked(getCacheKey);

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(containersRoutes);
  return app;
}

const fakeEndpoint = (id: number, name: string, status = 1) => ({
  Id: id,
  Name: name,
  Status: status,
  Snapshots: [],
});

const fakeContainer = (id: string, name: string, state = 'running') => ({
  Id: id,
  Names: [`/${name}`],
  Image: 'nginx:latest',
  State: state,
  Status: state === 'running' ? 'Up 2 hours' : 'Exited (0) 1 hour ago',
  Created: 1700000000,
  Ports: [],
  Labels: {},
  NetworkSettings: { Networks: {} },
});

describe('containers routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return containers from healthy endpoints', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
    ] as any);

    mockGetContainers.mockResolvedValue([
      fakeContainer('abc123', 'web'),
      fakeContainer('def456', 'api'),
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('web');
    expect(body[1].name).toBe('api');
  });

  it('should return 502 when all up endpoints fail', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);

    mockGetContainers.mockRejectedValue(new Error('Connection refused'));

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Failed to fetch containers from Portainer');
    expect(body.details).toHaveLength(2);
    expect(body.details[0]).toContain('prod');
    expect(body.details[1]).toContain('staging');
  });

  it('should return partial results with partial flag when some endpoints fail (#745)', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);

    mockGetContainers.mockImplementation(async (endpointId: number) => {
      if (endpointId === 1) return [fakeContainer('abc123', 'web')] as any;
      throw new Error('Connection refused');
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // When some endpoints fail, response wraps in object with partial flag
    expect(body.partial).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('web');
    expect(body.failedEndpoints).toBeDefined();
    expect(body.failedEndpoints).toHaveLength(1);
    expect(body.failedEndpoints[0]).toContain('staging');
  });

  it('should include partial flag in paginated response when some endpoints fail (#745)', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);

    mockGetContainers.mockImplementation(async (endpointId: number) => {
      if (endpointId === 1) return [fakeContainer('abc123', 'web')] as any;
      throw new Error('HTTP 500: Internal Server Error');
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?page=1&pageSize=10',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.partial).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.failedEndpoints).toHaveLength(1);
  });

  it('should return 502 when getEndpoints() fails', async () => {
    mockGetEndpoints.mockRejectedValue(new Error('ECONNREFUSED'));

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unable to connect to Portainer');
    expect(body.details).toContain('ECONNREFUSED');
  });

  it('should skip down endpoints without error', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod', 2), // down
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(0);
    expect(mockGetContainers).not.toHaveBeenCalled();
  });

  it('should return 502 when getContainer fails for detail endpoint', async () => {
    mockGetContainer.mockRejectedValue(new Error('Container not found'));

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123',
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unable to fetch container details from Portainer');
    expect(body.details).toContain('Container not found');
  });

  it('should cache container detail responses via cachedFetchSWR (#728)', async () => {
    mockGetContainer.mockResolvedValue(fakeContainer('abc123', 'web') as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123',
    });

    expect(res.statusCode).toBe(200);

    // Verify cachedFetchSWR was called with the container-detail cache key
    const swr = mockCachedFetchSWR.mock.calls.find((call) => {
      const key = call[0] as string;
      return key.includes('container-detail');
    });
    expect(swr).toBeDefined();
    // TTL should be STATS (60s)
    expect(swr![1]).toBe(60);
  });
});

describe('pagination (#544)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupContainers(count: number) {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    const containers = Array.from({ length: count }, (_, i) =>
      fakeContainer(`id${i}`, `container-${i}`, i % 3 === 0 ? 'stopped' : 'running'),
    );
    mockGetContainers.mockResolvedValue(containers as any);
  }

  it('returns flat array when no pagination params (backward compat)', async () => {
    setupContainers(5);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(5);
  });

  it('returns paginated response when page is provided', async () => {
    setupContainers(10);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?page=1&pageSize=3',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(10);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(3);
  });

  it('returns empty data for page beyond total', async () => {
    setupContainers(5);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?page=100&pageSize=10',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(5);
  });

  it('filters by search term', async () => {
    setupContainers(10);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?search=container-3',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Flat array (no pagination params)
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].name).toBe('container-3');
  });

  it('filters by state', async () => {
    setupContainers(9);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?state=stopped&page=1&pageSize=50',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Containers at index 0, 3, 6 are stopped (i % 3 === 0)
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
    for (const c of body.data) {
      expect(c.state).toBe('stopped');
    }
  });

  it('combines search and state filters with pagination', async () => {
    setupContainers(20);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?search=container-1&state=running&page=1&pageSize=50',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    for (const c of body.data) {
      expect(c.name).toContain('container-1');
      expect(c.state).toBe('running');
    }
  });

  it('defaults pageSize to 50 when only page is given', async () => {
    setupContainers(60);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers?page=1',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(50);
    expect(body.pageSize).toBe(50);
  });
});

describe('container count endpoint (#544)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns total and counts by state', async () => {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    mockGetContainers.mockResolvedValue([
      fakeContainer('a', 'web', 'running'),
      fakeContainer('b', 'api', 'running'),
      fakeContainer('c', 'db', 'stopped'),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers/count' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(3);
    expect(body.byState.running).toBe(2);
    expect(body.byState.stopped).toBe(1);
  });

  it('returns 502 when Portainer is unreachable', async () => {
    mockGetEndpoints.mockRejectedValue(new Error('ECONNREFUSED'));

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers/count' });

    expect(res.statusCode).toBe(502);
  });
});

describe('favorites endpoint (#544)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only requested containers', async () => {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    mockGetContainers.mockResolvedValue([
      fakeContainer('abc', 'web'),
      fakeContainer('def', 'api'),
      fakeContainer('ghi', 'db'),
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/favorites?ids=1:abc,1:ghi',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body.map((c: any) => c.name).sort()).toEqual(['db', 'web']);
  });

  it('returns empty array for empty ids', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/favorites?ids=',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(0);
  });

  it('returns empty when no containers match', async () => {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    mockGetContainers.mockResolvedValue([
      fakeContainer('abc', 'web'),
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/favorites?ids=1:nonexistent',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(0);
  });
});
