import type { Endpoint, Container, Stack, Network, K8sPod, K8sDeployment, K8sService, K8sNamespace } from '../models/portainer.js';
import { isKubernetesEndpoint, isDockerEndpoint } from '../models/portainer.js';
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
  /**
   * Where the container counts came from (issue #1249).
   * - `live`: fetched live via `/docker/info` through the Docker tunnel — set by
   *   `applyLiveDockerInfo` after a successful live query.
   * - `unavailable`: live-fetch not yet attempted or failed/timed out. Counts are
   *   0/0/0 and the UI should label this distinctly from a genuinely empty endpoint.
   */
  snapshotSource: 'live' | 'unavailable';
  /** Epoch millis of when the counts were last refreshed. Set when `snapshotSource` is `live`. */
  snapshotFetchedAt?: number;
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
 * Determine Edge endpoint status using a heartbeat check with a small jitter buffer.
 *
 * For Edge Agent Standard, Portainer's API `Status` field represents the
 * **tunnel state** (usually 2 = closed), NOT the agent's connectivity.
 * Portainer's own UI uses `LastCheckInDate` to show the green dot.
 *
 * We apply the Portainer heartbeat formula plus a 30-second jitter buffer
 * (one L1 cache cycle) to tolerate minor clock skew and poll latency.
 * The previous 900-second (full Redis cache TTL) buffer masked real outages
 * for up to 16 minutes and has been removed (issue #1006).
 */
function determineEdgeStatus(ep: Endpoint): 'up' | 'down' {
  // If Portainer explicitly says up, trust it
  if (ep.Status === 1) return 'up';

  const lastCheckIn = ep.LastCheckInDate;
  if (!lastCheckIn || lastCheckIn <= 0) return 'down';

  const interval = ep.EdgeCheckinInterval ?? 5;
  // Portainer's heartbeat formula: (interval * 2) + 20, minimum 60s
  const heartbeatThreshold = Math.max((interval * 2) + 20, 60);
  // Add a small jitter buffer (one L1 cache cycle) to tolerate clock skew
  const JITTER_SECONDS = 30;
  const generousThreshold = heartbeatThreshold + JITTER_SECONDS;

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
  // Portainer Type 7 = Edge Agent Async (poll-based, no Docker tunnel).
  // Type 4 = Edge Agent Standard (persistent tunnel, supports live features).
  // Previously we used QueryDate presence as a heuristic, but that field can
  // also be set on standard edge agents, causing false negatives.
  const edgeMode: 'standard' | 'async' | null = isEdge
    ? (ep.Type === 7 ? 'async' : 'standard')
    : null;

  return {
    id: ep.Id,
    name: ep.Name,
    type: ep.Type,
    url: ep.URL,
    status,
    containersRunning: 0,
    containersStopped: 0,
    containersHealthy: 0,
    containersUnhealthy: 0,
    totalContainers: 0,
    stackCount: 0,
    totalCpu: 0,
    totalMemory: 0,
    isEdge,
    edgeMode,
    snapshotAge: null,
    checkInInterval: ep.EdgeCheckinInterval ?? null,
    capabilities: buildCapabilities(edgeMode),
    agentVersion: ep.Agent?.Version,
    lastCheckIn: ep.LastCheckInDate,
    // Counts are always zero until a live fetch overlays them via applyLiveDockerInfo.
    // markLiveUnavailable keeps this 'unavailable' to signal the UI distinctly.
    snapshotSource: 'unavailable',
  };
}

/**
 * True when an endpoint can be live-queried via `/docker/info`: it must be up
 * and a Docker endpoint (types 1/2/4). K8s (5/6) and Edge Async (7) have no
 * Docker tunnel and are excluded.
 *
 * Note: Edge Async (type 7) is excluded even though it is an "Edge" type —
 * `isDockerEndpoint` groups it under KUBERNETES_ENDPOINT_TYPES in portainer.ts,
 * so it correctly returns false here.
 */
export function endpointSupportsLiveDockerInfo(ep: NormalizedEndpoint): boolean {
  return ep.status === 'up' && isDockerEndpoint(ep.type);
}

/** @deprecated Use endpointSupportsLiveDockerInfo. Kept until packages/foundation/src/services/edge-live-enrichment.ts is removed. */
export function endpointNeedsLiveFallback(ep: NormalizedEndpoint): boolean {
  return (
    ep.isEdge &&
    ep.edgeMode === 'standard' &&
    ep.status === 'up' &&
    ep.totalContainers === 0 &&
    ep.containersRunning === 0 &&
    ep.containersStopped === 0
  );
}

/** Live `/docker/info` payload shape — narrow enough to keep this file zero-dependency. */
export interface LiveDockerInfoCounts {
  containers: number;
  containersRunning: number;
  containersStopped: number;
  containersPaused?: number;
  ncpu?: number;
  memTotal?: number;
  fetchedAt: number;
}

/**
 * Overlay live Docker-info counts onto a normalized endpoint and mark the
 * snapshot source as `live`. Returns the updated endpoint (mutated in place,
 * since the caller owns it from `endpoints.map(normalizeEndpoint)`).
 */
export function applyLiveDockerInfo(
  ep: NormalizedEndpoint,
  info: LiveDockerInfoCounts,
): NormalizedEndpoint {
  ep.containersRunning = info.containersRunning;
  ep.containersStopped = info.containersStopped;
  ep.totalContainers = info.containers;
  if (info.ncpu != null) ep.totalCpu = info.ncpu;
  if (info.memTotal != null) ep.totalMemory = info.memTotal;
  ep.snapshotSource = 'live';
  ep.snapshotFetchedAt = info.fetchedAt;
  ep.snapshotAge = Date.now() - info.fetchedAt;
  return ep;
}

/**
 * Mark a normalized endpoint as `unavailable` — used when the live-fetch
 * fallback was attempted but failed/timed out. Counts stay 0/0/0; the
 * frontend uses the marker to render a distinct "data unavailable" state
 * instead of a misleading "no containers".
 */
export function markLiveUnavailable(ep: NormalizedEndpoint): NormalizedEndpoint {
  ep.snapshotSource = 'unavailable';
  return ep;
}

/** Extract Docker health check status from the Status string (e.g. "Up 2 hours (healthy)"). */
function parseHealthStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  if (status.includes('(healthy)')) return 'healthy';
  if (status.includes('(unhealthy)')) return 'unhealthy';
  if (status.includes('(health:')) return 'starting';
  return undefined;
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
    healthStatus: parseHealthStatus(c.Status),
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
export { isKubernetesEndpoint, isDockerEndpoint } from '../models/portainer.js';
