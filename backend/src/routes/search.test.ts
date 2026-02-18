import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { searchRoutes } from './search.js';

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: vi.fn(),
  getContainers: vi.fn(),
  getImages: vi.fn(),
  getStacks: vi.fn(),
  getContainerLogs: vi.fn(),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetch: vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  getCacheKey: (...args: Array<string | number>) => args.join(':'),
  TTL: {
    ENDPOINTS: 0,
    CONTAINERS: 0,
    IMAGES: 0,
    STACKS: 0,
  },
}));

vi.mock('../services/edge-capability-guard.js', () => ({
  supportsLiveFeatures: vi.fn(async () => true),
}));

import * as portainer from '../services/portainer-client.js';

const mockPortainer = vi.mocked(portainer);

function seedPortainerMocks() {
  mockPortainer.getEndpoints.mockResolvedValue([
    { Id: 1, Name: 'prod', Status: 1 },
  ] as any);

  mockPortainer.getContainers.mockResolvedValue([
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

  mockPortainer.getImages.mockResolvedValue([
    { Id: 'img1', RepoTags: ['web-proxy:latest'], Size: 123, Created: 1700000000 },
  ] as any);

  mockPortainer.getStacks.mockResolvedValue([
    { Id: 7, Name: 'web-stack', Type: 1, EndpointId: 1, Status: 1, Env: [] },
  ] as any);

  mockPortainer.getContainerLogs.mockResolvedValue(
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
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mockPortainer.getContainerLogs).not.toHaveBeenCalled();
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
    expect(mockPortainer.getContainerLogs).toHaveBeenCalled();
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
    expect(mockPortainer.getContainerLogs).not.toHaveBeenCalled();
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
    mockPortainer.getEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1 },
      { Id: 2, Name: 'staging', Status: 1 },
    ] as any);

    mockPortainer.getContainers.mockResolvedValue([
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

    mockPortainer.getImages.mockResolvedValue([]) as any;
    mockPortainer.getStacks.mockResolvedValue([]) as any;

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web-app',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    // getContainers and getImages should have been called once per endpoint
    expect(mockPortainer.getContainers).toHaveBeenCalledTimes(2);
    expect(mockPortainer.getImages).toHaveBeenCalledTimes(2);
    // Results from both endpoints
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(2);
  });

  it('returns partial results when one endpoint fails', async () => {
    mockPortainer.getEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1 },
      { Id: 2, Name: 'broken', Status: 1 },
    ] as any);

    mockPortainer.getContainers
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

    mockPortainer.getImages.mockResolvedValue([]) as any;
    mockPortainer.getStacks.mockResolvedValue([]) as any;

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
