import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { stacksRoutes } from './stacks.js';

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../services/portainer-client.js', async (importOriginal) => await importOriginal());

import * as portainerClient from '../services/portainer-client.js';
import { cache, waitForInFlight } from '../services/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetStack: any;
let mockGetStacksByEndpoint: any;
let mockGetContainers: any;

afterEach(async () => {
  await waitForInFlight();
});

afterAll(async () => {
  await closeTestRedis();
});

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

const fakeEdgeEndpoint = (id: number, name: string, lastCheckIn: number, status = 1) => ({
  Id: id,
  Name: name,
  Type: 4,
  URL: 'tcp://10.0.0.2:9001',
  Status: status,
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

const fakeContainer = (id: string, labels: Record<string, string> = {}) => ({
  Id: id,
  Names: [`/${id}`],
  Image: 'test:latest',
  State: 'running',
  Status: 'Up 1 hour',
  Created: 0,
  Ports: [],
  Labels: labels,
  NetworkSettings: { Networks: {} },
});

describe('stacks routes', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints');
    mockGetStack = vi.spyOn(portainerClient, 'getStack');
    mockGetStacksByEndpoint = vi.spyOn(portainerClient, 'getStacksByEndpoint');
    mockGetContainers = vi.spyOn(portainerClient, 'getContainers');
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

  it('includes stacks from Edge endpoints with recent check-in (Status=2, tunnel closed)', async () => {
    const recentCheckIn = Math.floor(Date.now() / 1000) - 10;
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'local'),
      fakeEdgeEndpoint(2, 'edge-node', recentCheckIn, 2), // Status=2 is normal for Edge Standard
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

  // --- compose-label fallback tests ---

  it('infers compose stacks from container labels when Portainer returns zero stacks', async () => {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'local')] as any);
    mockGetStacksByEndpoint.mockResolvedValueOnce([] as any);
    mockGetContainers.mockResolvedValueOnce([
      fakeContainer('c1', { 'com.docker.compose.project': 'my-app' }),
      fakeContainer('c2', { 'com.docker.compose.project': 'my-app' }),
      fakeContainer('c3', { 'com.docker.compose.project': 'other-app' }),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    const names = body.map((s: any) => s.name).sort();
    expect(names).toEqual(['my-app', 'other-app']);
    const myApp = body.find((s: any) => s.name === 'my-app');
    expect(myApp.source).toBe('compose-label');
    expect(myApp.containerCount).toBe(2);
    expect(myApp.id).toBeLessThan(0); // synthetic negative ID
  });

  it('returns both Portainer and inferred stacks without duplicates', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'managed'),
      fakeEndpoint(2, 'unmanaged'),
    ] as any);
    mockGetStacksByEndpoint
      .mockResolvedValueOnce([fakeStack(10, 'web-app', 1)] as any)
      .mockResolvedValueOnce([] as any);
    mockGetContainers.mockResolvedValueOnce([
      fakeContainer('c1', { 'com.docker.compose.project': 'infra' }),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body.find((s: any) => s.name === 'web-app').source).toBe('portainer');
    expect(body.find((s: any) => s.name === 'infra').source).toBe('compose-label');
  });

  it('deduplicates when Portainer stack name matches compose project label', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'ep1'),
      fakeEndpoint(2, 'ep2'),
    ] as any);
    mockGetStacksByEndpoint
      .mockResolvedValueOnce([fakeStack(10, 'my-app', 1)] as any)
      .mockResolvedValueOnce([] as any);
    mockGetContainers.mockResolvedValueOnce([
      fakeContainer('c1', { 'com.docker.compose.project': 'my-app' }),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].source).toBe('portainer');
  });

  it('skips container fetch for endpoints that have Portainer stacks', async () => {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'managed')] as any);
    mockGetStacksByEndpoint.mockResolvedValueOnce([fakeStack(1, 'web-app', 1)] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    expect(mockGetContainers).not.toHaveBeenCalled();
  });

  it('recognizes com.docker.stack.namespace label', async () => {
    mockGetEndpoints.mockResolvedValue([fakeEndpoint(1, 'local')] as any);
    mockGetStacksByEndpoint.mockResolvedValueOnce([] as any);
    mockGetContainers.mockResolvedValueOnce([
      fakeContainer('c1', { 'com.docker.stack.namespace': 'swarm-stack' }),
    ] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('swarm-stack');
    expect(body[0].source).toBe('compose-label');
  });
});
