import { FastifyInstance } from 'fastify';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import {
  normalizePod,
  normalizeDeployment,
  normalizeService,
  normalizeNamespace,
  normalizeEndpoint,
} from '@dashboard/core/portainer/portainer-normalizers.js';
import { isKubernetesEndpoint } from '@dashboard/core/models/portainer.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('kubernetes-routes');

/** Get all "up" Kubernetes endpoints, normalized. */
async function getK8sEndpoints() {
  const endpoints = await cachedFetch(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => portainer.getEndpoints(),
  );
  return endpoints
    .filter((ep) => isKubernetesEndpoint(ep.Type))
    .map(normalizeEndpoint)
    .filter((ep) => ep.status === 'up');
}

export async function kubernetesRoutes(fastify: FastifyInstance) {
  // ── Pods ───────────────────────────────────────────────────────────────────
  fastify.get('/api/kubernetes/pods', {
    schema: {
      tags: ['Kubernetes'],
      summary: 'List pods across all Kubernetes endpoints',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          endpointId: { type: 'number' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { namespace, endpointId } = request.query as { namespace?: string; endpointId?: number };
    const endpoints = await getK8sEndpoints();
    const filtered = endpointId ? endpoints.filter((ep) => ep.id === endpointId) : endpoints;

    const results = await Promise.allSettled(
      filtered.map(async (ep) => {
        const pods = await cachedFetch(
          getCacheKey('k8s-pods', ep.id, namespace ?? 'all'),
          TTL.K8S_PODS,
          () => portainer.getPods(ep.id, namespace),
        );
        return pods.map((pod) => normalizePod(pod, ep.id, ep.name));
      }),
    );

    const pods = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        pods.push(...result.value);
      } else {
        const ep = filtered[i];
        log.warn({ endpointId: ep.id, err: result.reason }, 'Failed to fetch pods');
        errors.push({ endpointId: ep.id, endpointName: ep.name, error: String(result.reason) });
      }
    }

    return { pods, errors, partial: errors.length > 0 };
  });

  // ── Deployments ────────────────────────────────────────────────────────────
  fastify.get('/api/kubernetes/deployments', {
    schema: {
      tags: ['Kubernetes'],
      summary: 'List deployments across all Kubernetes endpoints',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          endpointId: { type: 'number' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { namespace, endpointId } = request.query as { namespace?: string; endpointId?: number };
    const endpoints = await getK8sEndpoints();
    const filtered = endpointId ? endpoints.filter((ep) => ep.id === endpointId) : endpoints;

    const results = await Promise.allSettled(
      filtered.map(async (ep) => {
        const deployments = await cachedFetch(
          getCacheKey('k8s-deployments', ep.id, namespace ?? 'all'),
          TTL.K8S_DEPLOYMENTS,
          () => portainer.getDeployments(ep.id, namespace),
        );
        return deployments.map((dep) => normalizeDeployment(dep, ep.id, ep.name));
      }),
    );

    const deployments = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        deployments.push(...result.value);
      } else {
        const ep = filtered[i];
        log.warn({ endpointId: ep.id, err: result.reason }, 'Failed to fetch deployments');
        errors.push({ endpointId: ep.id, endpointName: ep.name, error: String(result.reason) });
      }
    }

    return { deployments, errors, partial: errors.length > 0 };
  });

  // ── Services ───────────────────────────────────────────────────────────────
  fastify.get('/api/kubernetes/services', {
    schema: {
      tags: ['Kubernetes'],
      summary: 'List services across all Kubernetes endpoints',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          endpointId: { type: 'number' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { namespace, endpointId } = request.query as { namespace?: string; endpointId?: number };
    const endpoints = await getK8sEndpoints();
    const filtered = endpointId ? endpoints.filter((ep) => ep.id === endpointId) : endpoints;

    const results = await Promise.allSettled(
      filtered.map(async (ep) => {
        const services = await cachedFetch(
          getCacheKey('k8s-services', ep.id, namespace ?? 'all'),
          TTL.K8S_SERVICES,
          () => portainer.getServices(ep.id, namespace),
        );
        return services.map((svc) => normalizeService(svc, ep.id, ep.name));
      }),
    );

    const services = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        services.push(...result.value);
      } else {
        const ep = filtered[i];
        log.warn({ endpointId: ep.id, err: result.reason }, 'Failed to fetch services');
        errors.push({ endpointId: ep.id, endpointName: ep.name, error: String(result.reason) });
      }
    }

    return { services, errors, partial: errors.length > 0 };
  });

  // ── Namespaces ─────────────────────────────────────────────────────────────
  fastify.get('/api/kubernetes/namespaces', {
    schema: {
      tags: ['Kubernetes'],
      summary: 'List namespaces across all Kubernetes endpoints',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          endpointId: { type: 'number' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.query as { endpointId?: number };
    const endpoints = await getK8sEndpoints();
    const filtered = endpointId ? endpoints.filter((ep) => ep.id === endpointId) : endpoints;

    const results = await Promise.allSettled(
      filtered.map(async (ep) => {
        const namespaces = await cachedFetch(
          getCacheKey('k8s-namespaces', ep.id),
          TTL.K8S_NAMESPACES,
          () => portainer.getNamespaces(ep.id),
        );
        return namespaces.map((ns) => normalizeNamespace(ns, ep.id, ep.name));
      }),
    );

    const namespaces = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        namespaces.push(...result.value);
      } else {
        const ep = filtered[i];
        log.warn({ endpointId: ep.id, err: result.reason }, 'Failed to fetch namespaces');
        errors.push({ endpointId: ep.id, endpointName: ep.name, error: String(result.reason) });
      }
    }

    return { namespaces, errors, partial: errors.length > 0 };
  });

  // ── Pod Logs (read-only) ──────────────────────────────────────────────────
  fastify.get('/api/kubernetes/pods/:endpointId/:namespace/:podName/logs', {
    schema: {
      tags: ['Kubernetes'],
      summary: 'Get pod logs (read-only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['endpointId', 'namespace', 'podName'],
        properties: {
          endpointId: { type: 'number' },
          namespace: { type: 'string' },
          podName: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          tail: { type: 'number', default: 100 },
          sinceSeconds: { type: 'number' },
          timestamps: { type: 'boolean', default: true },
          container: { type: 'string' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, namespace, podName } = request.params as {
      endpointId: number;
      namespace: string;
      podName: string;
    };
    const { tail, sinceSeconds, timestamps, container } = request.query as {
      tail?: number;
      sinceSeconds?: number;
      timestamps?: boolean;
      container?: string;
    };

    try {
      const logs = await portainer.getPodLogs(endpointId, namespace, podName, {
        tail,
        sinceSeconds,
        timestamps,
        container,
      });
      return { logs };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, endpointId, namespace, podName }, 'Failed to fetch pod logs');
      return reply.code(502).send({ error: 'Unable to fetch pod logs from Portainer', details: msg });
    }
  });

  // ── Summary (for dashboard KPIs) ──────────────────────────────────────────
  fastify.get('/api/kubernetes/summary', {
    schema: {
      tags: ['Kubernetes'],
      summary: 'Kubernetes cluster summary (pod counts by state)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const endpoints = await getK8sEndpoints();

    const results = await Promise.allSettled(
      endpoints.map(async (ep) => {
        const pods = await cachedFetch(
          getCacheKey('k8s-pods', ep.id, 'all'),
          TTL.K8S_PODS,
          () => portainer.getPods(ep.id),
        );
        return pods.map((pod) => normalizePod(pod, ep.id, ep.name));
      }),
    );

    let running = 0;
    let pending = 0;
    let failed = 0;
    let succeeded = 0;
    let unknown = 0;
    const allPods = [];

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const pod of result.value) {
        allPods.push(pod);
        switch (pod.state) {
          case 'running': running++; break;
          case 'pending': pending++; break;
          case 'failed': failed++; break;
          case 'succeeded': succeeded++; break;
          default: unknown++; break;
        }
      }
    }

    return {
      total: allPods.length,
      running,
      pending,
      failed,
      succeeded,
      unknown,
      endpointCount: endpoints.length,
    };
  });
}
