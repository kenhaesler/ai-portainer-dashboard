import type { Endpoint, Container, Stack, Network, K8sPod, K8sDeployment, K8sService, K8sNamespace } from '../models/portainer.js';
import { isKubernetesEndpoint } from '../models/portainer.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('normalizers');

export interface EdgeCapabilities {
  exec: boolean;
  realtimeLogs: boolean;
  liveStats: boolean;
  immediateActions: boolean;
}

export interface NormalizedEndpoint {
  id: number;
  name: string;
  type: number;
  url: string;
  status: 'up' | 'down';
  containersRunning: number;
  containersStopped: number;
  containersHealthy: number;
  containersUnhealthy: number;
  totalContainers: number;
  stackCount: number;
  totalCpu: number;
  totalMemory: number;
  isEdge: boolean;
  edgeMode: 'standard' | 'async' | null;
  snapshotAge: number | null;
  checkInInterval: number | null;
  capabilities: EdgeCapabilities;
  agentVersion?: string;
  lastCheckIn?: number;
}

export interface NormalizedContainer {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'stopped' | 'paused' | 'dead' | 'unknown';
  status: string;
  created: number;
  endpointId: number;
  endpointName: string;
  ports: Array<{ private: number; public?: number; type: string }>;
  networks: string[];
  networkIPs: Record<string, string>;
  labels: Record<string, string>;
  healthStatus?: string;
}

export interface NormalizedStack {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: 'active' | 'inactive';
  createdAt?: number;
  updatedAt?: number;
  envCount: number;
  source: 'portainer' | 'compose-label';
  containerCount?: number;
}

export interface NormalizedNetwork {
  id: string;
  name: string;
  driver?: string;
  scope?: string;
  subnet?: string;
  gateway?: string;
  endpointId: number;
  endpointName: string;
  containers: string[];
}

function buildCapabilities(edgeMode: 'standard' | 'async' | null): EdgeCapabilities {
  if (edgeMode === 'async') {
    return { exec: false, realtimeLogs: false, liveStats: false, immediateActions: false };
  }
  // Edge Standard and non-edge both support all interactive features
  return { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true };
}

/**
 * Determine Edge endpoint status using a cache-aware heartbeat check.
 *
 * For Edge Agent Standard, Portainer's API `Status` field represents the
 * **tunnel state** (usually 2 = closed), NOT the agent's connectivity.
 * Portainer's own UI uses `LastCheckInDate` to show the green dot.
 *
 * We use the heartbeat with a generous threshold: the Portainer heartbeat
 * window PLUS the cache TTL (15 min). This ensures that an endpoint which
 * was "up" when cached won't drift to "down" before the cache expires.
 */
function determineEdgeStatus(ep: Endpoint): 'up' | 'down' {
  // If Portainer explicitly says up, trust it
  if (ep.Status === 1) return 'up';

  const lastCheckIn = ep.LastCheckInDate;
  if (!lastCheckIn || lastCheckIn <= 0) return 'down';

  const interval = ep.EdgeCheckinInterval ?? 5;
  // Portainer's heartbeat formula: (interval * 2) + 20, minimum 60s
  const heartbeatThreshold = Math.max((interval * 2) + 20, 60);
  // Add cache TTL so the status doesn't drift to "down" while cached
  const CACHE_TTL_SECONDS = 900;
  const generousThreshold = heartbeatThreshold + CACHE_TTL_SECONDS;

  const elapsed = Math.floor(Date.now() / 1000) - lastCheckIn;
  return elapsed <= generousThreshold ? 'up' : 'down';
}

export function normalizeEndpoint(ep: Endpoint): NormalizedEndpoint {
  const isEdge = !!ep.EdgeID;
  // Non-Edge: trust Portainer's Status field directly.
  // Edge: Status=2 means "tunnel closed" (normal for Edge Standard),
  // so we use a cache-aware heartbeat check instead (see issue #489).
  const status: 'up' | 'down' = isEdge
    ? determineEdgeStatus(ep)
    : (ep.Status === 1 ? 'up' : 'down');

  if (isEdge) {
    log.debug({
      endpointId: ep.Id,
      name: ep.Name,
      portainerStatus: ep.Status,
      resolvedStatus: status,
      lastCheckInDate: ep.LastCheckInDate,
      edgeCheckinInterval: ep.EdgeCheckinInterval,
    }, 'Normalizing Edge endpoint');
  }
  const snapshot = ep.Snapshots?.[0];
  const raw = snapshot?.DockerSnapshotRaw;
  // Portainer Type 7 = Edge Agent Async (poll-based, no Docker tunnel).
  // Type 4 = Edge Agent Standard (persistent tunnel, supports live features).
  // Previously we used QueryDate presence as a heuristic, but that field can
  // also be set on standard edge agents, causing false negatives.
  const edgeMode: 'standard' | 'async' | null = isEdge
    ? (ep.Type === 7 ? 'async' : 'standard')
    : null;
  const snapshotTime = snapshot?.Time;
  const snapshotAge = snapshotTime ? Date.now() - snapshotTime * 1000 : null;

  return {
    id: ep.Id,
    name: ep.Name,
    type: ep.Type,
    url: ep.URL,
    status,
    containersRunning: snapshot?.RunningContainerCount ?? raw?.ContainersRunning ?? 0,
    containersStopped: snapshot?.StoppedContainerCount ?? raw?.ContainersStopped ?? 0,
    containersHealthy: snapshot?.HealthyContainerCount ?? 0,
    containersUnhealthy: snapshot?.UnhealthyContainerCount ?? 0,
    totalContainers: (raw?.Containers) ?? (
      (snapshot?.RunningContainerCount ?? 0) + (snapshot?.StoppedContainerCount ?? 0)
    ),
    stackCount: snapshot?.StackCount ?? 0,
    totalCpu: snapshot?.TotalCPU ?? 0,
    totalMemory: snapshot?.TotalMemory ?? 0,
    isEdge,
    edgeMode,
    snapshotAge,
    checkInInterval: ep.EdgeCheckinInterval ?? null,
    capabilities: buildCapabilities(edgeMode),
    agentVersion: ep.Agent?.Version,
    lastCheckIn: ep.LastCheckInDate,
  };
}

export function normalizeContainer(
  c: Container,
  endpointId: number,
  endpointName: string,
): NormalizedContainer {
  const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
  let state: NormalizedContainer['state'] = 'unknown';
  switch (c.State?.toLowerCase()) {
    case 'running': state = 'running'; break;
    case 'exited':
    case 'stopped': state = 'stopped'; break;
    case 'paused': state = 'paused'; break;
    case 'dead': state = 'dead'; break;
  }

  return {
    id: c.Id,
    name,
    image: c.Image,
    state,
    status: c.Status,
    created: c.Created,
    endpointId,
    endpointName,
    ports: (c.Ports || []).map((p) => ({
      private: p.PrivatePort || 0,
      public: p.PublicPort,
      type: p.Type || 'tcp',
    })),
    networks: Object.keys(c.NetworkSettings?.Networks || {}),
    networkIPs: Object.fromEntries(
      Object.entries(c.NetworkSettings?.Networks || {})
        .filter(([, v]: [string, any]) => v?.IPAddress)
        .map(([k, v]: [string, any]) => [k, v.IPAddress as string]),
    ),
    labels: c.Labels || {},
    healthStatus: c.Labels?.['com.docker.compose.service'],
  };
}

export function normalizeStack(s: Stack): NormalizedStack {
  return {
    id: s.Id,
    name: s.Name,
    type: s.Type,
    endpointId: s.EndpointId,
    status: s.Status === 1 ? 'active' : 'inactive',
    createdAt: s.CreationDate,
    updatedAt: s.UpdateDate,
    envCount: s.Env?.length || 0,
    source: 'portainer',
  };
}

/** Label keys used to detect compose project membership on containers. */
export const COMPOSE_PROJECT_LABELS = [
  'com.docker.compose.project',
  'com.docker.stack.namespace',
  'io.portainer.stack.name',
] as const;

/** Simple string hash → negative number to avoid collision with Portainer IDs. */
export function syntheticStackId(endpointId: number, projectName: string): number {
  let hash = 0;
  const key = `${endpointId}:${projectName}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash || 1);
}

export function normalizeNetwork(
  n: Network,
  endpointId: number,
  endpointName: string,
): NormalizedNetwork {
  const ipamConfig = n.IPAM?.Config?.[0];
  return {
    id: n.Id,
    name: n.Name,
    driver: n.Driver,
    scope: n.Scope,
    subnet: ipamConfig?.Subnet,
    gateway: ipamConfig?.Gateway,
    endpointId,
    endpointName,
    containers: Object.keys(n.Containers || {}),
  };
}

// ── Kubernetes Normalizers ─────────────────────────────────────────────────

export type K8sPodState = 'running' | 'pending' | 'succeeded' | 'failed' | 'unknown';

export interface NormalizedPod {
  id: string;
  name: string;
  namespace: string;
  images: string[];
  state: K8sPodState;
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

export interface NormalizedDeployment {
  id: string;
  name: string;
  namespace: string;
  images: string[];
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  created: number;
  endpointId: number;
  endpointName: string;
  labels: Record<string, string>;
  resourceType: 'deployment';
}

export interface NormalizedService {
  id: string;
  name: string;
  namespace: string;
  serviceType: string;
  clusterIP?: string;
  ports: Array<{ name?: string; port: number; targetPort?: string | number; protocol: string; nodePort?: number }>;
  created: number;
  endpointId: number;
  endpointName: string;
  labels: Record<string, string>;
  resourceType: 'service';
}

export interface NormalizedNamespace {
  id: string;
  name: string;
  status: string;
  created: number;
  labels: Record<string, string>;
  endpointId: number;
  endpointName: string;
  resourceType: 'namespace';
}

function parseK8sTimestamp(ts?: string): number {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

function mapPodPhase(phase?: string): K8sPodState {
  switch (phase?.toLowerCase()) {
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    default: return 'unknown';
  }
}

/** Build a human-readable status string for a pod (e.g. "Running", "CrashLoopBackOff"). */
function buildPodStatusString(pod: K8sPod): string {
  const phase = pod.status?.phase ?? 'Unknown';
  // Check container statuses for more specific reasons
  for (const cs of pod.status?.containerStatuses ?? []) {
    const waiting = cs.state?.['waiting'] as { reason?: string } | undefined;
    if (waiting?.reason) return waiting.reason;
    const terminated = cs.state?.['terminated'] as { reason?: string } | undefined;
    if (terminated?.reason) return terminated.reason;
  }
  return phase;
}

export function normalizePod(
  pod: K8sPod,
  endpointId: number,
  endpointName: string,
): NormalizedPod {
  const restarts = (pod.status?.containerStatuses ?? [])
    .reduce((sum, cs) => sum + (cs.restartCount ?? 0), 0);

  return {
    id: pod.metadata.uid ?? `${pod.metadata.namespace}/${pod.metadata.name}`,
    name: pod.metadata.name,
    namespace: pod.metadata.namespace ?? 'default',
    images: pod.spec.containers.map((c) => c.image ?? '').filter(Boolean),
    state: mapPodPhase(pod.status?.phase),
    status: buildPodStatusString(pod),
    restarts,
    created: parseK8sTimestamp(pod.metadata.creationTimestamp),
    nodeName: pod.spec.nodeName,
    podIP: pod.status?.podIP,
    endpointId,
    endpointName,
    labels: pod.metadata.labels ?? {},
    containers: pod.spec.containers.map((specC) => {
      const statusC = (pod.status?.containerStatuses ?? []).find((s) => s.name === specC.name);
      return {
        name: specC.name,
        image: specC.image,
        ready: statusC?.ready ?? false,
        restartCount: statusC?.restartCount ?? 0,
      };
    }),
    resourceType: 'pod',
  };
}

export function normalizeDeployment(
  dep: K8sDeployment,
  endpointId: number,
  endpointName: string,
): NormalizedDeployment {
  const images = (dep.spec.template?.spec?.containers ?? [])
    .map((c) => c.image ?? '').filter(Boolean);

  return {
    id: dep.metadata.uid ?? `${dep.metadata.namespace}/${dep.metadata.name}`,
    name: dep.metadata.name,
    namespace: dep.metadata.namespace ?? 'default',
    images,
    replicas: dep.spec.replicas ?? 1,
    readyReplicas: dep.status?.readyReplicas ?? 0,
    availableReplicas: dep.status?.availableReplicas ?? 0,
    updatedReplicas: dep.status?.updatedReplicas ?? 0,
    created: parseK8sTimestamp(dep.metadata.creationTimestamp),
    endpointId,
    endpointName,
    labels: dep.metadata.labels ?? {},
    resourceType: 'deployment',
  };
}

export function normalizeService(
  svc: K8sService,
  endpointId: number,
  endpointName: string,
): NormalizedService {
  return {
    id: svc.metadata.uid ?? `${svc.metadata.namespace}/${svc.metadata.name}`,
    name: svc.metadata.name,
    namespace: svc.metadata.namespace ?? 'default',
    serviceType: svc.spec.type ?? 'ClusterIP',
    clusterIP: svc.spec.clusterIP,
    ports: (svc.spec.ports ?? []).map((p) => ({
      name: p.name,
      port: p.port,
      targetPort: p.targetPort,
      protocol: p.protocol ?? 'TCP',
      nodePort: p.nodePort,
    })),
    created: parseK8sTimestamp(svc.metadata.creationTimestamp),
    endpointId,
    endpointName,
    labels: svc.metadata.labels ?? {},
    resourceType: 'service',
  };
}

export function normalizeNamespace(
  ns: K8sNamespace,
  endpointId: number,
  endpointName: string,
): NormalizedNamespace {
  return {
    id: ns.metadata.uid ?? ns.metadata.name,
    name: ns.metadata.name,
    status: ns.status?.phase ?? 'Active',
    created: parseK8sTimestamp(ns.metadata.creationTimestamp),
    labels: ns.metadata.labels ?? {},
    endpointId,
    endpointName,
    resourceType: 'namespace',
  };
}

/** Re-export for convenience */
export { isKubernetesEndpoint } from '../models/portainer.js';
