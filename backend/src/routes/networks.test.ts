import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { networksRoutes } from './networks.js';

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { cache, waitForInFlight } from '@dashboard/core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetNetworks: any;

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
  app.register(networksRoutes);
  return app;
}

const fakeEndpoint = (id: number, name: string, status = 1) => ({
  Id: id,
  Name: name,
  Status: status,
  Snapshots: [],
});

const fakeNetwork = (id: string, name: string) => ({
  Id: id,
  Name: name,
  Driver: 'bridge',
  Scope: 'local',
  IPAM: { Config: [{ Subnet: '172.17.0.0/16', Gateway: '172.17.0.1' }] },
  Containers: {},
});

describe('networks routes', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints');
    mockGetNetworks = vi.spyOn(portainerClient, 'getNetworks');
  });

  it('should return networks from healthy endpoints', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
    ] as any);

    mockGetNetworks.mockResolvedValue([
      fakeNetwork('net1', 'bridge'),
      fakeNetwork('net2', 'app-network'),
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/networks',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('bridge');
    expect(body[1].name).toBe('app-network');
  });

  it('should return 502 when all up endpoints fail', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);

    mockGetNetworks.mockRejectedValue(new Error('Connection refused'));

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/networks',
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Failed to fetch networks from Portainer');
    expect(body.details).toHaveLength(2);
    expect(body.details[0]).toContain('prod');
    expect(body.details[1]).toContain('staging');
  });

  it('should return partial results when some endpoints fail', async () => {
    mockGetEndpoints.mockResolvedValue([
      fakeEndpoint(1, 'prod'),
      fakeEndpoint(2, 'staging'),
    ] as any);

    mockGetNetworks.mockImplementation(async (endpointId: number) => {
      if (endpointId === 1) return [fakeNetwork('net1', 'bridge')] as any;
      throw new Error('Connection refused');
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/networks',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('bridge');
  });

  it('should return 502 when getEndpoints() fails', async () => {
    mockGetEndpoints.mockRejectedValue(new Error('ECONNREFUSED'));

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/networks',
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
      url: '/api/networks',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(0);
    expect(mockGetNetworks).not.toHaveBeenCalled();
  });
});
