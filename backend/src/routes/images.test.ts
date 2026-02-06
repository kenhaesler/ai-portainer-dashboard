import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { imagesRoutes } from './images.js';

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: vi.fn(),
  getImages: vi.fn(),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetch: vi.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  getCacheKey: vi.fn((...args: string[]) => args.join(':')),
  TTL: { ENDPOINTS: 30, CONTAINERS: 15 },
}));

import * as portainer from '../services/portainer-client.js';

const mockGetEndpoints = vi.mocked(portainer.getEndpoints);
const mockGetImages = vi.mocked(portainer.getImages);

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(imagesRoutes);
  return app;
}

describe('images routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should de-duplicate images across endpoints', async () => {
    const sharedImageId = 'sha256:abc123';
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1, Snapshots: [] },
      { Id: 2, Name: 'staging', Status: 1, Snapshots: [] },
    ] as any);

    mockGetImages.mockImplementation(async (endpointId: number) => {
      return [
        {
          Id: sharedImageId,
          RepoTags: ['nginx:latest'],
          Size: 100_000_000,
          Created: 1700000000,
        },
      ] as any;
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/images',
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    // Should be de-duplicated to 1 image, not 2
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(sharedImageId);
    // Endpoint name should contain both endpoints
    expect(body[0].endpointName).toContain('prod');
    expect(body[0].endpointName).toContain('staging');
  });

  it('should return unique images when no duplicates', async () => {
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1, Snapshots: [] },
    ] as any);

    mockGetImages.mockResolvedValue([
      { Id: 'sha256:aaa', RepoTags: ['nginx:latest'], Size: 50_000_000, Created: 1700000000 },
      { Id: 'sha256:bbb', RepoTags: ['redis:7'], Size: 30_000_000, Created: 1700000000 },
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/images',
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(2);
  });

  it('should return images for specific endpoint without de-duplication', async () => {
    mockGetImages.mockResolvedValue([
      { Id: 'sha256:aaa', RepoTags: ['nginx:latest'], Size: 50_000_000, Created: 1700000000 },
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/images?endpointId=1',
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toContain('nginx');
  });

  it('should parse registry from image tags', async () => {
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod', Status: 1, Snapshots: [] },
    ] as any);

    mockGetImages.mockResolvedValue([
      { Id: 'sha256:ccc', RepoTags: ['ghcr.io/org/app:v1'], Size: 80_000_000, Created: 1700000000 },
    ] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/images',
    });

    const body = JSON.parse(res.body);
    expect(body[0].registry).toBe('ghcr.io');
    expect(body[0].name).toBe('org/app');
  });
});
