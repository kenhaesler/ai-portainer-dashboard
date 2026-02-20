import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { imagesRoutes } from './images.js';

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../services/portainer-client.js', async (importOriginal) => await importOriginal());

import * as portainerClient from '../services/portainer-client.js';
import { cache, waitForInFlight } from '../services/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetImages: any;

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
  app.decorate('requireRole', () => async () => undefined);
  app.register(imagesRoutes);
  return app;
}

describe('images routes', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints');
    mockGetImages = vi.spyOn(portainerClient, 'getImages');
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
