import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { kubernetesRoutes } from '@dashboard/foundation';
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';
import { cache, waitForInFlight } from '@dashboard/core/portainer/portainer-cache.js';

afterEach(async () => {
  await waitForInFlight();
});

afterAll(async () => {
  await closeTestRedis();
});

function buildApp() {
  const app = Fastify();
  // Match production wiring: routes use Zod schemas via fastify-type-provider-zod.
  // Without this, Fastify's default ajv validator can't parse Zod objects and
  // route registration fails with "schema is invalid: data/required must be array".
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(kubernetesRoutes);
  return app;
}

// Endpoint type 5 = Kubernetes (local)
const fakeK8sEndpoint = (id: number, name: string, status = 1) => ({
  Id: id,
  Name: name,
  Type: 5,
  Status: status,
  Snapshots: [],
});

// Docker endpoints should be filtered OUT by K8s routes
const fakeDockerEndpoint = (id: number, name: string, status = 1) => ({
  Id: id,
  Name: name,
  Type: 1,
  Status: status,
  Snapshots: [],
});

const fakePod = (name: string, phase = 'Running') => ({
  metadata: {
    uid: `uid-${name}`,
    name,
    namespace: 'default',
    creationTimestamp: '2024-01-01T00:00:00Z',
    labels: {},
  },
  spec: {
    nodeName: 'node-1',
    containers: [{ name: 'app' }],
  },
  status: {
    phase,
    containerStatuses: [{
      name: 'app',
      ready: phase === 'Running',
      restartCount: 0,
      state: phase === 'Running' ? { running: {} } : { waiting: {} },
    }],
  },
});

const fakeDeployment = (name: string, replicas = 3) => ({
  metadata: {
    uid: `uid-${name}`,
    name,
    namespace: 'default',
    creationTimestamp: '2024-01-01T00:00:00Z',
    labels: {},
  },
  spec: { replicas },
  status: {
    replicas,
    readyReplicas: replicas,
    availableReplicas: replicas,
    updatedReplicas: replicas,
  },
});

const fakeService = (name: string) => ({
  metadata: {
    uid: `uid-${name}`,
    name,
    namespace: 'default',
    creationTimestamp: '2024-01-01T00:00:00Z',
    labels: {},
  },
  spec: {
    type: 'ClusterIP',
    clusterIP: '10.96.0.1',
    ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }],
  },
});

const fakeNamespace = (name: string) => ({
  metadata: {
    uid: `uid-${name}`,
    name,
    creationTimestamp: '2024-01-01T00:00:00Z',
    labels: {},
  },
  status: { phase: 'Active' },
});

describe('kubernetes routes', () => {
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
  });

  describe('GET /api/kubernetes/pods', () => {
    it('should return pods from K8s endpoints only', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
        fakeDockerEndpoint(1, 'docker-host'),
      ] as any);
      vi.spyOn(portainerClient, 'getPods').mockResolvedValue([
        fakePod('nginx-abc'),
        fakePod('redis-def'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.pods).toHaveLength(2);
      expect(body.pods[0].name).toBe('nginx-abc');
      expect(body.pods[0].endpointId).toBe(10);
      expect(body.pods[0].endpointName).toBe('k8s-cluster');
      expect(body.pods[0].resourceType).toBe('pod');
      // getPods should NOT have been called with docker endpoint ID
      expect(portainerClient.getPods).toHaveBeenCalledTimes(1);
      expect(portainerClient.getPods).toHaveBeenCalledWith(10, undefined);
    });

    it('should filter by namespace', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
      ] as any);
      vi.spyOn(portainerClient, 'getPods').mockResolvedValue([
        fakePod('app-1'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods?namespace=kube-system',
      });

      expect(res.statusCode).toBe(200);
      expect(portainerClient.getPods).toHaveBeenCalledWith(10, 'kube-system');
    });

    it('should return partial results when some endpoints fail', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-1'),
        fakeK8sEndpoint(20, 'k8s-2'),
      ] as any);
      vi.spyOn(portainerClient, 'getPods').mockImplementation(async (epId: number) => {
        if (epId === 20) throw new Error('Connection refused');
        return [fakePod('working-pod')] as any;
      });

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.pods).toHaveLength(1);
      expect(body.errors).toHaveLength(1);
      expect(body.partial).toBe(true);
    });
  });

  describe('GET /api/kubernetes/deployments', () => {
    it('should return deployments from K8s endpoints', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
      ] as any);
      vi.spyOn(portainerClient, 'getDeployments').mockResolvedValue([
        fakeDeployment('web-app'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/deployments',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.deployments).toHaveLength(1);
      expect(body.deployments[0].name).toBe('web-app');
      expect(body.deployments[0].replicas).toBe(3);
      expect(body.deployments[0].resourceType).toBe('deployment');
    });
  });

  describe('GET /api/kubernetes/services', () => {
    it('should return services from K8s endpoints', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
      ] as any);
      vi.spyOn(portainerClient, 'getServices').mockResolvedValue([
        fakeService('api-svc'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/services',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.services).toHaveLength(1);
      expect(body.services[0].name).toBe('api-svc');
      expect(body.services[0].serviceType).toBe('ClusterIP');
      expect(body.services[0].resourceType).toBe('service');
    });
  });

  describe('GET /api/kubernetes/namespaces', () => {
    it('should return namespaces from K8s endpoints', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
      ] as any);
      vi.spyOn(portainerClient, 'getNamespaces').mockResolvedValue([
        fakeNamespace('default'),
        fakeNamespace('kube-system'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/namespaces',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.namespaces).toHaveLength(2);
      expect(body.namespaces[0].name).toBe('default');
      expect(body.namespaces[0].resourceType).toBe('namespace');
    });
  });

  describe('GET /api/kubernetes/summary', () => {
    it('should return pod counts by state', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
      ] as any);
      vi.spyOn(portainerClient, 'getPods').mockResolvedValue([
        fakePod('running-1', 'Running'),
        fakePod('running-2', 'Running'),
        fakePod('pending-1', 'Pending'),
        fakePod('failed-1', 'Failed'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/summary',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(4);
      expect(body.running).toBe(2);
      expect(body.pending).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.endpointCount).toBe(1);
    });

    it('should exclude Docker endpoints from summary', async () => {
      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        fakeK8sEndpoint(10, 'k8s-cluster'),
        fakeDockerEndpoint(1, 'docker-host'),
      ] as any);
      vi.spyOn(portainerClient, 'getPods').mockResolvedValue([
        fakePod('pod-1'),
      ] as any);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/summary',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Only K8s endpoint should be counted
      expect(body.endpointCount).toBe(1);
      expect(body.total).toBe(1);
    });
  });

  describe('GET /api/kubernetes/pods/:endpointId/:namespace/:podName/logs', () => {
    it('should return pod logs', async () => {
      vi.spyOn(portainerClient, 'getPodLogs').mockResolvedValue(
        '2024-01-01T00:00:00Z Starting server...\n2024-01-01T00:00:01Z Listening on :8080\n',
      );

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/kubernetes/pods/10/default/nginx-abc/logs?tail=100',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.logs).toContain('Starting server');
      expect(portainerClient.getPodLogs).toHaveBeenCalledWith(
        10, 'default', 'nginx-abc',
        expect.objectContaining({ tail: 100 }),
      );
    });
  });
});
