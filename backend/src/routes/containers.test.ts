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
  cachedFetch: vi.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  getCacheKey: vi.fn((...args: string[]) => args.join(':')),
  TTL: { ENDPOINTS: 30, CONTAINERS: 15 },
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
const mockGetContainers = vi.mocked(portainer.getContainers);
const mockGetContainer = vi.mocked(portainer.getContainer);

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

const fakeContainer = (id: string, name: string) => ({
  Id: id,
  Names: [`/${name}`],
  Image: 'nginx:latest',
  State: 'running',
  Status: 'Up 2 hours',
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

  it('should return partial results when some endpoints fail', async () => {
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
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('web');
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
});
