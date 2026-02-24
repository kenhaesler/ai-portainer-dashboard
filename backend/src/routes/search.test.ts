import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { searchRoutes } from './search.js';

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());

// Kept: infrastructure module mock — avoids real edge device checks
vi.mock('../modules/infrastructure/index.js', () => ({
  supportsLiveFeatures: vi.fn(async () => true),
}));

import * as portainerClient from '../core/portainer/portainer-client.js';
import { cache, waitForInFlight } from '../core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetContainers: any;
let mockGetImages: any;
let mockGetStacks: any;
let mockGetContainerLogs: any;

function seedPortainerMocks() {
  mockGetEndpoints.mockResolvedValue([
    { Id: 1, Name: 'prod', Status: 1 },
  ] as any);

  mockGetContainers.mockResolvedValue([
    {
      Id: 'abc123',
      Names: ['/web-frontend'],
      Image: 'nginx:alpine',
      State: 'running',
      Status: 'Up 2 hours',
      Created: 1700000000,
      Ports: [],
      NetworkSettings: { Networks: {} },
      Labels: { 'com.example.service': 'web' },
    },
  ] as any);

  mockGetImages.mockResolvedValue([
    { Id: 'img1', RepoTags: ['web-proxy:latest'], Size: 123, Created: 1700000000 },
  ] as any);

  mockGetStacks.mockResolvedValue([
    { Id: 7, Name: 'web-stack', Type: 1, EndpointId: 1, Status: 1, Env: [] },
  ] as any);

  mockGetContainerLogs.mockResolvedValue(
    '2024-01-01T10:00:00Z web request handled\n2024-01-01T10:00:01Z ok',
  );
}

describe('Search Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(searchRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints');
    mockGetContainers = vi.spyOn(portainerClient, 'getContainers');
    mockGetImages = vi.spyOn(portainerClient, 'getImages');
    mockGetStacks = vi.spyOn(portainerClient, 'getStacks');
    mockGetContainerLogs = vi.spyOn(portainerClient, 'getContainerLogs');
  });

  it('returns matches across containers, images, and stacks without logs by default', async () => {
    seedPortainerMocks();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(1);
    expect(body.images).toHaveLength(1);
    expect(body.stacks).toHaveLength(1);
    // Logs are opt-in — not included by default
    expect(body.logs).toHaveLength(0);
    expect(mockGetContainerLogs).not.toHaveBeenCalled();
  });

  it('includes log results when includeLogs=true', async () => {
    seedPortainerMocks();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web&includeLogs=true',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(1);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].containerName).toBe('web-frontend');
    expect(mockGetContainerLogs).toHaveBeenCalled();
  });

  it('does not fetch logs when includeLogs=false explicitly', async () => {
    seedPortainerMocks();

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web&includeLogs=false',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.logs).toHaveLength(0);
    expect(mockGetContainerLogs).not.toHaveBeenCalled();
  });

  it('returns empty results for short queries', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=w',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(0);
    expect(body.images).toHaveLength(0);
    expect(body.stacks).toHaveLength(0);
    expect(body.logs).toHaveLength(0);
  });

  it('fetches containers and images in parallel across multiple endpoints', async () => {
    // Two endpoints — verify containers and images are fetched for both
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1 },
      { Id: 2, Name: 'staging', Status: 1 },
    ] as any);

    mockGetContainers.mockResolvedValue([
      {
        Id: 'abc123',
        Names: ['/web-app'],
        Image: 'nginx:alpine',
        State: 'running',
        Status: 'Up 2 hours',
        Created: 1700000000,
        Ports: [],
        NetworkSettings: { Networks: {} },
        Labels: {},
      },
    ] as any);

    mockGetImages.mockResolvedValue([]) as any;
    mockGetStacks.mockResolvedValue([]) as any;

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web-app',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    // getContainers and getImages should have been called once per endpoint
    expect(mockGetContainers).toHaveBeenCalledTimes(2);
    expect(mockGetImages).toHaveBeenCalledTimes(2);
    // Results from both endpoints
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(2);
  });

  it('returns partial results when one endpoint fails', async () => {
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1 },
      { Id: 2, Name: 'broken', Status: 1 },
    ] as any);

    mockGetContainers
      .mockResolvedValueOnce([
        {
          Id: 'abc123',
          Names: ['/web-app'],
          Image: 'nginx:alpine',
          State: 'running',
          Status: 'Up 2 hours',
          Created: 1700000000,
          Ports: [],
          NetworkSettings: { Networks: {} },
          Labels: {},
        },
      ] as any)
      .mockRejectedValueOnce(new Error('endpoint unreachable'));

    mockGetImages.mockResolvedValue([]) as any;
    mockGetStacks.mockResolvedValue([]) as any;

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web-app',
      headers: { authorization: 'Bearer test' },
    });

    // Should still succeed with results from the working endpoint
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(1);
  });
});
