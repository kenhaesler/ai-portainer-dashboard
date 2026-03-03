import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { STALE_TIMES } from '@/shared/lib/query-constants';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface K8sPod {
  id: string;
  name: string;
  namespace: string;
  images: string[];
  state: 'running' | 'pending' | 'succeeded' | 'failed' | 'unknown';
  status: string;
  restarts: number;
  created: number;
  nodeName?: string;
  podIP?: string;
  endpointId: number;
  endpointName: string;
  labels: Record<string, string>;
  containers: Array<{ name: string; image?: string; ready: boolean; restartCount: number }>;
  resourceType: 'pod';
}

export interface K8sDeployment {
  id: string;
  name: string;
  namespace: string;
  images: string[];
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  created: number;
  labels: Record<string, string>;
  endpointId: number;
  endpointName: string;
  resourceType: 'deployment';
}

export interface K8sService {
  id: string;
  name: string;
  namespace: string;
  serviceType: string;
  clusterIP?: string;
  ports: Array<{
    name?: string;
    port: number;
    targetPort: number | string;
    protocol: string;
    nodePort?: number;
  }>;
  created: number;
  labels: Record<string, string>;
  endpointId: number;
  endpointName: string;
  resourceType: 'service';
}

export interface K8sNamespace {
  id: string;
  name: string;
  status: string;
  created: number;
  labels: Record<string, string>;
  endpointId: number;
  endpointName: string;
  resourceType: 'namespace';
}

export interface K8sSummary {
  total: number;
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unknown: number;
  endpointCount: number;
}

interface K8sListResponse<T> {
  pods?: T[];
  deployments?: T[];
  services?: T[];
  namespaces?: T[];
  errors: Array<{ endpointId: number; endpointName: string; error: string }>;
  partial: boolean;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useK8sPods(params?: { namespace?: string; endpointId?: number }) {
  const { namespace, endpointId } = params ?? {};

  return useQuery<K8sPod[]>({
    queryKey: ['kubernetes', 'pods', { namespace, endpointId }],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (namespace) searchParams.set('namespace', namespace);
      if (endpointId !== undefined) searchParams.set('endpointId', String(endpointId));
      const qs = searchParams.toString();
      const path = qs ? `/api/kubernetes/pods?${qs}` : '/api/kubernetes/pods';
      const res = await api.get<K8sListResponse<K8sPod>>(path);
      return res.pods ?? [];
    },
    staleTime: STALE_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useK8sDeployments(params?: { namespace?: string; endpointId?: number }) {
  const { namespace, endpointId } = params ?? {};

  return useQuery<K8sDeployment[]>({
    queryKey: ['kubernetes', 'deployments', { namespace, endpointId }],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (namespace) searchParams.set('namespace', namespace);
      if (endpointId !== undefined) searchParams.set('endpointId', String(endpointId));
      const qs = searchParams.toString();
      const path = qs ? `/api/kubernetes/deployments?${qs}` : '/api/kubernetes/deployments';
      const res = await api.get<K8sListResponse<K8sDeployment>>(path);
      return res.deployments ?? [];
    },
    staleTime: STALE_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useK8sServices(params?: { namespace?: string; endpointId?: number }) {
  const { namespace, endpointId } = params ?? {};

  return useQuery<K8sService[]>({
    queryKey: ['kubernetes', 'services', { namespace, endpointId }],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (namespace) searchParams.set('namespace', namespace);
      if (endpointId !== undefined) searchParams.set('endpointId', String(endpointId));
      const qs = searchParams.toString();
      const path = qs ? `/api/kubernetes/services?${qs}` : '/api/kubernetes/services';
      const res = await api.get<K8sListResponse<K8sService>>(path);
      return res.services ?? [];
    },
    staleTime: STALE_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useK8sNamespaces(params?: { endpointId?: number }) {
  const { endpointId } = params ?? {};

  return useQuery<K8sNamespace[]>({
    queryKey: ['kubernetes', 'namespaces', { endpointId }],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (endpointId !== undefined) searchParams.set('endpointId', String(endpointId));
      const qs = searchParams.toString();
      const path = qs ? `/api/kubernetes/namespaces?${qs}` : '/api/kubernetes/namespaces';
      const res = await api.get<K8sListResponse<K8sNamespace>>(path);
      return res.namespaces ?? [];
    },
    staleTime: STALE_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useK8sSummary() {
  return useQuery<K8sSummary>({
    queryKey: ['kubernetes', 'summary'],
    queryFn: () => api.get<K8sSummary>('/api/kubernetes/summary'),
    staleTime: STALE_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useK8sPodLogs(
  endpointId: number,
  namespace: string,
  podName: string,
  options?: { tail?: number; sinceSeconds?: number; container?: string },
) {
  return useQuery<{ logs: string }>({
    queryKey: ['kubernetes', 'pod-logs', endpointId, namespace, podName, options],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (options?.tail !== undefined) searchParams.set('tail', String(options.tail));
      if (options?.sinceSeconds !== undefined) searchParams.set('sinceSeconds', String(options.sinceSeconds));
      if (options?.container) searchParams.set('container', options.container);
      searchParams.set('timestamps', 'true');
      const qs = searchParams.toString();
      return api.get<{ logs: string }>(
        `/api/kubernetes/pods/${endpointId}/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/logs?${qs}`,
      );
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!endpointId && !!namespace && !!podName,
  });
}
