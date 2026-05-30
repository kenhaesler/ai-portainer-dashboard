import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { kubernetesRoutes } from '../routes/kubernetes.js';

// Passthrough mock: keep real client module writable so individual functions can be spied.
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
// Bypass caching so each test exercises a fresh upstream call.
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => {
  const real = await importOriginal() as typeof import('@dashboard/core/portainer/portainer-cache.js');
  return {
    ...real,
    cachedFetch: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
    cachedFetchSWR: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  };
});

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';

const k8sEndpoint = (id: number, name: string) => ({
  Id: id,
  Name: name,
  Type: 5, // Kubernetes Local
  Status: 1, // up
  Snapshots: [],
  EdgeID: null,
  LastCheckInDate: null,
  EdgeCheckinInterval: null,
});

describe('Kubernetes Routes - querystring validation (regression for #1231)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(kubernetesRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      k8sEndpoint(1, 'k8s-prod'),
    ] as any);
    vi.spyOn(portainerClient, 'getPods').mockResolvedValue([]);
    vi.spyOn(portainerClient, 'getDeployments').mockResolvedValue([]);
    vi.spyOn(portainerClient, 'getServices').mockResolvedValue([]);
    vi.spyOn(portainerClient, 'getNamespaces').mockResolvedValue([]);
  });

  // The bug: querystrings were defined as raw JSON Schema, which the
  // fastify-type-provider-zod validator could not parse — every request
  // returned 500 with `Cannot read properties of undefined (reading 'run')`.
  // These tests assert validation succeeds and the route runs.

  describe('GET /api/kubernetes/pods', () => {
    it('accepts empty querystring without 500', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/kubernetes/pods' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('pods');
      expect(body).toHaveProperty('errors');
    });

    it('accepts namespace and coerces endpointId from string', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods?namespace=default&endpointId=1',
      });
      expect(res.statusCode).toBe(200);
      // Confirms endpointId coercion: filter should keep endpoint 1.
      expect(portainerClient.getPods).toHaveBeenCalledWith(1, 'default');
    });

    it('rejects non-numeric endpointId with 400 (not 500)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods?endpointId=not-a-number',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/kubernetes/deployments', () => {
    it('accepts empty querystring without 500', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/kubernetes/deployments' });
      expect(res.statusCode).toBe(200);
    });

    it('accepts valid querystring', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/deployments?namespace=kube-system&endpointId=1',
      });
      expect(res.statusCode).toBe(200);
      expect(portainerClient.getDeployments).toHaveBeenCalledWith(1, 'kube-system');
    });
  });

  describe('GET /api/kubernetes/services', () => {
    it('accepts empty querystring without 500', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/kubernetes/services' });
      expect(res.statusCode).toBe(200);
    });

    it('accepts valid querystring', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/services?namespace=default&endpointId=1',
      });
      expect(res.statusCode).toBe(200);
      expect(portainerClient.getServices).toHaveBeenCalledWith(1, 'default');
    });
  });

  describe('GET /api/kubernetes/namespaces', () => {
    it('accepts empty querystring without 500', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/kubernetes/namespaces' });
      expect(res.statusCode).toBe(200);
    });

    it('accepts endpointId querystring', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/namespaces?endpointId=1',
      });
      expect(res.statusCode).toBe(200);
      expect(portainerClient.getNamespaces).toHaveBeenCalledWith(1);
    });
  });

  describe('GET /api/kubernetes/pods/:endpointId/:namespace/:podName/logs', () => {
    it('accepts empty querystring (defaults applied)', async () => {
      vi.spyOn(portainerClient, 'getPodLogs').mockResolvedValue('hello');
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods/1/default/my-pod/logs',
      });
      expect(res.statusCode).toBe(200);
      expect(portainerClient.getPodLogs).toHaveBeenCalledWith(
        1,
        'default',
        'my-pod',
        expect.objectContaining({ tail: 100, timestamps: true }),
      );
    });

    it('accepts full querystring with coerced types', async () => {
      vi.spyOn(portainerClient, 'getPodLogs').mockResolvedValue('hello');
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods/1/default/my-pod/logs?tail=50&sinceSeconds=60&timestamps=false&container=app',
      });
      expect(res.statusCode).toBe(200);
      expect(portainerClient.getPodLogs).toHaveBeenCalledWith(
        1,
        'default',
        'my-pod',
        { tail: 50, sinceSeconds: 60, timestamps: false, container: 'app' },
      );
    });
  });
});
