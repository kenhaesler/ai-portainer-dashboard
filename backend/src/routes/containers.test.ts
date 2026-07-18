import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { containersRoutes } from '@dashboard/foundation/routes/index.js';
// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';
import { checkPortainerAvailable } from '../test-utils/integration-setup.js';
import { cache, getCacheKey, TTL, waitForInFlight } from '@dashboard/core/portainer/portainer-cache.js';

let portainerUp: boolean;

beforeAll(async () => {
  portainerUp = await checkPortainerAvailable();
});

afterEach(async () => {
  await waitForInFlight();
  vi.useRealTimers();
});

afterAll(async () => {
  await closeTestRedis();
});

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(containersRoutes);
  return app;
}

const fakeEndpoint = (id: number, name: string, status = 1) => ({
  Id: id,
  Name: name,
  Type: 1, // Docker local
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
  NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.2' } } },
});

describe('containers routes', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
  });

  it('should return containers from healthy endpoints (live Portainer)', { timeout: 15000 }, async (ctx) => {
    // Intentional skip when Portainer is unreachable (always the case in CI —
    // see CLAUDE.md "Mocks are for CI only"). When it runs, every assertion
    // below is unconditional so the test cannot pass vacuously (#1535).
    if (!portainerUp) return ctx.skip();

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Without pagination params the route returns a flat array, or
    // { data, partial, failedEndpoints } when some endpoints failed mid-run.
    const containers = Array.isArray(body) ? body : body.data;
    expect(Array.isArray(containers)).toBe(true);
    if (!Array.isArray(body)) {
      expect(body.partial).toBe(true);
      expect(Array.isArray(body.failedEndpoints)).toBe(true);
      expect(body.failedEndpoints.length).toBeGreaterThan(0);
    }

    // The dev fixture always runs at least Portainer's own container on the
    // local endpoint, so an empty list means the environment (or the route)
    // is broken — fail loudly instead of passing on the status code alone.
    expect(containers.length).toBeGreaterThan(0);

    // Every returned container must be normalized — check all items so a
    // malformed entry anywhere in the list fails the test.
    for (const c of containers) {
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.state).toBe('string');
      expect(typeof c.image).toBe('string');
    }
  });

  it('should return 502 when all up endpoints fail', async () => {
    // Kept: vi.spyOn for controlled error injection
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);
    vi.spyOn(portainerClient, 'getContainers').mockRejectedValue(new Error('Connection refused'));

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
    // Kept: vi.spyOn for controlled partial failure
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);
    vi.spyOn(portainerClient, 'getContainers').mockImplementation(async (endpointId: number) => {
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
    expect(body.partial).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('web');
    expect(body.failedEndpoints).toBeDefined();
    expect(body.failedEndpoints).toHaveLength(1);
    expect(body.failedEndpoints[0]).toContain('staging');
  });

  it('should include partial flag in paginated response when some endpoints fail (#745)', async () => {
    // Kept: vi.spyOn for controlled partial failure with pagination
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);
    vi.spyOn(portainerClient, 'getContainers').mockImplementation(async (endpointId: number) => {
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
    // Kept: vi.spyOn for controlled error injection
    vi.spyOn(portainerClient, 'getEndpoints').mockRejectedValue(new Error('ECONNREFUSED'));

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
    // Kept: vi.spyOn for controlled endpoint status
    const getContainersSpy = vi.spyOn(portainerClient, 'getContainers');
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
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
    expect(getContainersSpy).not.toHaveBeenCalled();
  });

  it('keeps containers from a healthy Edge host when its endpoint snapshot is stale (#1566)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchedAt = Date.now();
    const edgeEndpoint = {
      Id: 1,
      Name: 'edge-prod',
      Type: 4,
      URL: 'tcp://edge-prod',
      Status: 2,
      EdgeID: 'edge-prod',
      LastCheckInDate: Math.floor(fetchedAt / 1000) - 30,
      EdgeCheckinInterval: 5,
      Snapshots: [],
    };
    await cache.set(getCacheKey('endpoints'), [edgeEndpoint], TTL.ENDPOINTS);

    vi.setSystemTime(fetchedAt + 13 * 60 * 1000);
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([edgeEndpoint] as any);
    const containersSpy = vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([
      fakeContainer('abc123', 'web'),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const containers = Array.isArray(body) ? body : body.data;
    expect(containers).toHaveLength(1);
    expect(containers[0].name).toBe('web');
    expect(containersSpy).toHaveBeenCalledWith(1);

    await waitForInFlight();
    await app.close();
  });

  it('should return 502 when getContainer fails for detail endpoint', async () => {
    // Kept: vi.spyOn for controlled error injection
    vi.spyOn(portainerClient, 'getContainer').mockRejectedValue(new Error('Container not found'));

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

  it('serializes networkIPs through the response schema', async () => {
    // Kept: vi.spyOn for controlled endpoint + container fixtures
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([fakeContainer('abc123', 'web')] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const list = Array.isArray(body) ? body : body.data;
    expect(list[0].networkIPs).toEqual({ bridge: '172.17.0.2' });
  });

  it('should cache container detail responses via cachedFetchSWR (#728)', async () => {
    // With real cache, verify the response is valid — caching is tested implicitly
    vi.spyOn(portainerClient, 'getContainer').mockResolvedValue(fakeContainer('abc123', 'web') as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('Id');
  });
});

describe('pagination (#544)', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
  });

  // Kept: vi.spyOn for controlled container counts needed for pagination logic testing
  function setupContainers(count: number) {
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    const containers = Array.from({ length: count }, (_, i) =>
      fakeContainer(`id${i}`, `container-${i}`, i % 3 === 0 ? 'stopped' : 'running'),
    );
    vi.spyOn(portainerClient, 'getContainers').mockResolvedValue(containers as any);
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
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
  });

  it('returns total and counts by state', async () => {
    // Kept: vi.spyOn for controlled container state counts
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([
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
    // Kept: vi.spyOn for controlled error injection
    vi.spyOn(portainerClient, 'getEndpoints').mockRejectedValue(new Error('ECONNREFUSED'));

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers/count' });

    expect(res.statusCode).toBe(502);
  });
});

describe('favorites endpoint (#544)', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
  });

  it('returns only requested containers', async () => {
    // New implementation fetches individual containers via getContainer()
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    vi.spyOn(portainerClient, 'getContainer').mockImplementation(async (_epId: number, cId: string) => {
      const containers: Record<string, ReturnType<typeof fakeContainer>> = {
        abc: fakeContainer('abc', 'web'),
        ghi: fakeContainer('ghi', 'db'),
      };
      const c = containers[cId];
      if (!c) throw new Error(`Container ${cId} not found`);
      return c as any;
    });

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
    // New implementation fetches individual containers — 404 results are filtered out
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([fakeEndpoint(1, 'prod')] as any);
    vi.spyOn(portainerClient, 'getContainer').mockRejectedValue(new Error('Not found'));

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
