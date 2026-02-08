import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { stacksRoutes } from './stacks.js';

vi.mock('../services/portainer-client.js', () => ({
  getStacks: vi.fn(),
  getStack: vi.fn(),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetch: vi.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  getCacheKey: vi.fn((...args: string[]) => args.join(':')),
  TTL: { STACKS: 60 },
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

const mockGetStacks = vi.mocked(portainer.getStacks);
const mockGetStack = vi.mocked(portainer.getStack);

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(stacksRoutes);
  return app;
}

const fakeStack = (id: number, name: string) => ({
  Id: id,
  Name: name,
  Type: 1,
  EndpointId: 1,
  Status: 1,
  Env: [],
});

describe('stacks routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return stacks list', async () => {
    mockGetStacks.mockResolvedValue([fakeStack(1, 'web-app')] as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('web-app');
  });

  it('should return 502 when getStacks fails', async () => {
    mockGetStacks.mockRejectedValue(new Error('ECONNREFUSED'));

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks' });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unable to fetch stacks from Portainer');
    expect(body.details).toContain('ECONNREFUSED');
  });

  it('should return stack details', async () => {
    mockGetStack.mockResolvedValue(fakeStack(1, 'web-app') as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks/1' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('web-app');
  });

  it('should return 502 when getStack fails', async () => {
    mockGetStack.mockRejectedValue(new Error('Stack not found'));

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stacks/999' });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unable to fetch stack details from Portainer');
    expect(body.details).toContain('Stack not found');
  });
});
