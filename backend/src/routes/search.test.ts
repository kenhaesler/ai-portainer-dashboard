import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
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

import * as portainer from '../services/portainer-client.js';

const mockPortainer = vi.mocked(portainer);

describe('Search Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
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

  it('returns matches across containers, images, stacks, and logs', async () => {
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
      { Id: 'img1', RepoTags: ['nginx:alpine'], Size: 123, Created: 1700000000 },
    ] as any);

    mockPortainer.getStacks.mockResolvedValue([
      { Id: 7, Name: 'web-stack', Type: 1, EndpointId: 1, Status: 1, Env: [] },
    ] as any);

    mockPortainer.getContainerLogs.mockResolvedValue(
      '2024-01-01T10:00:00Z web request handled\n2024-01-01T10:00:01Z ok',
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=web',
      headers: {
        authorization: 'Bearer test',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(1);
    expect(body.images).toHaveLength(1);
    expect(body.stacks).toHaveLength(1);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].containerName).toBe('web-frontend');
  });

  it('returns empty results for short queries', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search?query=w',
      headers: {
        authorization: 'Bearer test',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.containers).toHaveLength(0);
    expect(body.images).toHaveLength(0);
    expect(body.stacks).toHaveLength(0);
    expect(body.logs).toHaveLength(0);
  });
});
