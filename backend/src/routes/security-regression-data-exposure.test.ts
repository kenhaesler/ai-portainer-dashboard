/**
 * Security Regression — Filesystem path leakage on container detail (#1564)
 *
 * `GET /api/containers/:endpointId/:containerId` used to return the raw
 * Portainer/Docker *inspect* object verbatim, with no Fastify response
 * schema. Docker inspect payloads carry host filesystem paths in
 * `Mounts[].Source`, `LogPath`, and `HostConfig.Binds` — exposing the host's
 * directory layout to any authenticated viewer, violating CLAUDE.md Security
 * §5 ("strip sensitive metadata before sending to frontend").
 *
 * The route now normalizes the response through `normalizeContainer()` (the
 * same projection used by the list/favorites endpoints) and declares a
 * `response: { 200: NormalizedContainerSchema }` schema. Both layers strip
 * paths independently:
 *   1. `portainer.getContainer()` bridges the raw inspect payload through
 *      `containerFromInspect()` (#1387), which drops `Mounts` entirely and
 *      only maps a fixed allow-list of `HostConfig` fields.
 *   2. `normalizeContainer()` only ever reads a fixed set of known fields
 *      onto the response — even if a future regression reintroduced
 *      filesystem paths onto the intermediate `Container` object, they could
 *      not reach the wire.
 *
 * This test simulates that "upstream regression" scenario directly: it mocks
 * `portainer.getContainer()` to return an object carrying host paths in all
 * three locations the issue calls out, then asserts none of them appear
 * anywhere in the serialized response body.
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1564
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { containersRoutes } from '@dashboard/foundation/routes/index.js';

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';

const HOST_PATH_MARKERS = [
  '/var/lib/docker/volumes/app_data/_data',
  '/var/lib/docker/containers/leaky123/leaky123-json.log',
  '/home/deploy/secrets/app-config',
];

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(containersRoutes);
  return app;
}

// A payload shaped like the intermediate `Container` object but carrying the
// three host-path fields the issue calls out, as if an upstream regression
// (e.g. a change to containerFromInspect) reintroduced them. `getContainer()`
// itself is mocked here — this test targets the route's own stripping via
// `normalizeContainer()`, independent of the client-layer protection.
const leakyContainer = {
  Id: 'leaky123',
  Names: ['/leaky-app'],
  Image: 'nginx:latest',
  State: 'running',
  Status: 'Up 1 hour',
  Created: 1700000000,
  Ports: [],
  Labels: { app: 'leaky' },
  NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.9' } } },
  // Host filesystem paths that must never reach the wire (#1564)
  LogPath: HOST_PATH_MARKERS[1],
  Mounts: [
    { Type: 'volume', Name: 'app_data', Source: HOST_PATH_MARKERS[0], Destination: '/data', Mode: '', RW: true },
  ],
  HostConfig: {
    NetworkMode: 'bridge',
    Binds: [`${HOST_PATH_MARKERS[2]}:/config:ro`],
  },
};

describe('container detail — filesystem path stripping (#1564)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('strips Mounts[].Source, LogPath, and HostConfig.Binds from the response', async () => {
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      { Id: 1, Name: 'prod', Type: 1, Status: 1, Snapshots: [] } as any,
    ]);
    vi.spyOn(portainerClient, 'getContainer').mockResolvedValue(leakyContainer as any);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers/1/leaky123' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const raw = res.body;

    // None of the known leak fields exist on the normalized shape at all.
    expect(body).not.toHaveProperty('Mounts');
    expect(body).not.toHaveProperty('LogPath');
    expect(body).not.toHaveProperty('HostConfig');

    // Belt-and-braces: none of the actual host path strings appear anywhere
    // in the serialized body, however they might have been nested.
    for (const marker of HOST_PATH_MARKERS) {
      expect(raw).not.toContain(marker);
    }

    // The fields the container-detail UI actually reads are still present.
    expect(body).toMatchObject({
      id: 'leaky123',
      name: 'leaky-app',
      image: 'nginx:latest',
      state: 'running',
      status: 'Up 1 hour',
      endpointId: 1,
      endpointName: 'prod',
      labels: { app: 'leaky' },
      networks: ['bridge'],
      networkIPs: { bridge: '172.17.0.9' },
    });
  });
});
