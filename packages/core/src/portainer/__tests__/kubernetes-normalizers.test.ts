import { describe, it, expect } from 'vitest';
import {
  normalizePod,
  normalizeDeployment,
  normalizeService,
  normalizeNamespace,
} from '../portainer-normalizers.js';
import { isDockerEndpoint, isKubernetesEndpoint } from '../../models/portainer.js';

describe('endpoint type helpers', () => {
  it('isDockerEndpoint returns true for Docker types (1,2,4)', () => {
    expect(isDockerEndpoint(1)).toBe(true);
    expect(isDockerEndpoint(2)).toBe(true);
    expect(isDockerEndpoint(4)).toBe(true);
  });

  it('isDockerEndpoint returns false for non-Docker types', () => {
    expect(isDockerEndpoint(3)).toBe(false); // Azure
    expect(isDockerEndpoint(5)).toBe(false); // K8s
    expect(isDockerEndpoint(6)).toBe(false); // Edge K8s
    expect(isDockerEndpoint(7)).toBe(false); // Edge Async
  });

  it('isKubernetesEndpoint returns true for K8s types (5,6,7)', () => {
    expect(isKubernetesEndpoint(5)).toBe(true);
    expect(isKubernetesEndpoint(6)).toBe(true);
    expect(isKubernetesEndpoint(7)).toBe(true);
  });

  it('isKubernetesEndpoint returns false for non-K8s types', () => {
    expect(isKubernetesEndpoint(1)).toBe(false);
    expect(isKubernetesEndpoint(2)).toBe(false);
    expect(isKubernetesEndpoint(3)).toBe(false);
    expect(isKubernetesEndpoint(4)).toBe(false);
  });
});

describe('normalizePod', () => {
  const basePod = {
    metadata: {
      uid: 'uid-1',
      name: 'nginx-abc',
      namespace: 'default',
      creationTimestamp: '2024-06-15T10:30:00Z',
      labels: { app: 'nginx' },
    },
    spec: {
      nodeName: 'node-1',
      containers: [{ name: 'nginx' }, { name: 'sidecar' }],
    },
    status: {
      phase: 'Running',
      containerStatuses: [
        { name: 'nginx', ready: true, restartCount: 2, state: { running: {} } },
        { name: 'sidecar', ready: true, restartCount: 0, state: { running: {} } },
      ],
    },
  };

  it('normalizes a running pod correctly', () => {
    const result = normalizePod(basePod as any, 10, 'k8s-cluster');

    expect(result.id).toBe('uid-1');
    expect(result.name).toBe('nginx-abc');
    expect(result.namespace).toBe('default');
    expect(result.state).toBe('running');
    expect(result.containers).toHaveLength(2);
    expect(result.containers.filter((c) => c.ready)).toHaveLength(2);
    expect(result.restarts).toBe(2); // sum of all containers
    expect(result.nodeName).toBe('node-1');
    expect(result.endpointId).toBe(10);
    expect(result.endpointName).toBe('k8s-cluster');
    expect(result.resourceType).toBe('pod');
    expect(result.labels).toEqual({ app: 'nginx' });
  });

  it('maps Failed phase to failed state', () => {
    const failedPod = {
      ...basePod,
      status: { ...basePod.status, phase: 'Failed' },
    };
    const result = normalizePod(failedPod as any, 10, 'cluster');
    expect(result.state).toBe('failed');
  });

  it('detects CrashLoopBackOff from container statuses', () => {
    const crashPod = {
      ...basePod,
      status: {
        phase: 'Running',
        containerStatuses: [{
          name: 'app',
          ready: false,
          restartCount: 10,
          state: { waiting: { reason: 'CrashLoopBackOff' } },
        }],
      },
    };
    const result = normalizePod(crashPod as any, 10, 'cluster');
    expect(result.status).toBe('CrashLoopBackOff');
  });
});

describe('normalizeDeployment', () => {
  it('normalizes a deployment correctly', () => {
    const dep = {
      metadata: {
        uid: 'dep-uid',
        name: 'web-app',
        namespace: 'production',
        creationTimestamp: '2024-06-15T10:30:00Z',
        labels: { tier: 'frontend' },
      },
      spec: { replicas: 3 },
      status: {
        replicas: 3,
        readyReplicas: 3,
        availableReplicas: 3,
        updatedReplicas: 3,
      },
    };

    const result = normalizeDeployment(dep as any, 10, 'cluster');
    expect(result.name).toBe('web-app');
    expect(result.namespace).toBe('production');
    expect(result.replicas).toBe(3);
    expect(result.readyReplicas).toBe(3);
    expect(result.resourceType).toBe('deployment');
  });
});

describe('normalizeService', () => {
  it('normalizes a service correctly', () => {
    const svc = {
      metadata: {
        uid: 'svc-uid',
        name: 'api-svc',
        namespace: 'default',
        creationTimestamp: '2024-06-15T10:30:00Z',
        labels: {},
      },
      spec: {
        type: 'NodePort',
        clusterIP: '10.96.0.50',
        ports: [
          { name: 'http', port: 80, targetPort: 8080, protocol: 'TCP', nodePort: 30080 },
        ],
      },
    };

    const result = normalizeService(svc as any, 10, 'cluster');
    expect(result.name).toBe('api-svc');
    expect(result.serviceType).toBe('NodePort');
    expect(result.clusterIP).toBe('10.96.0.50');
    expect(result.ports).toHaveLength(1);
    expect(result.ports[0].nodePort).toBe(30080);
    expect(result.resourceType).toBe('service');
  });
});

describe('normalizeNamespace', () => {
  it('normalizes a namespace correctly', () => {
    const ns = {
      metadata: {
        uid: 'ns-uid',
        name: 'kube-system',
        creationTimestamp: '2024-01-01T00:00:00Z',
        labels: { 'kubernetes.io/metadata.name': 'kube-system' },
      },
      status: { phase: 'Active' },
    };

    const result = normalizeNamespace(ns as any, 10, 'cluster');
    expect(result.name).toBe('kube-system');
    expect(result.status).toBe('Active');
    expect(result.resourceType).toBe('namespace');
    expect(result.endpointId).toBe(10);
  });
});
