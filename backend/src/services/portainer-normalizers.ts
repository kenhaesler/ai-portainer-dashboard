import type { Endpoint, Container, Stack, Network } from '../models/portainer.js';
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
 * Determine if an Edge endpoint is reachable based on its last check-in.
 * Portainer uses: (interval * 2) + 20 seconds as the heartbeat threshold.
 * We use a more generous formula: max((interval * 2) + 20, 60) to avoid
 * flapping for endpoints with short intervals.
 * If Portainer already reports Status === 1, trust it immediately.
 */
function determineEdgeStatus(ep: Endpoint): 'up' | 'down' {
  if (ep.Status === 1) return 'up';

  const lastCheckIn = ep.LastCheckInDate;
  if (lastCheckIn == null || lastCheckIn <= 0) {
    log.debug({ endpointId: ep.Id, name: ep.Name, status: ep.Status, lastCheckIn }, 'Edge endpoint has no LastCheckInDate — marking down');
    return 'down';
  }

  const interval = ep.EdgeCheckinInterval ?? 5;
  // Portainer formula: (interval * 2) + 20. We add a generous minimum of 60s.
  const threshold = Math.max((interval * 2) + 20, 60);
  const elapsed = Math.floor((Date.now() / 1000) - lastCheckIn);
  const result = elapsed <= threshold ? 'up' : 'down';

  log.debug({
    endpointId: ep.Id,
    name: ep.Name,
    portainerStatus: ep.Status,
    lastCheckIn,
    interval,
    threshold,
    elapsed,
    result,
  }, `Edge endpoint heartbeat check: ${result}`);

  return result;
}

export function normalizeEndpoint(ep: Endpoint): NormalizedEndpoint {
  const isEdge = !!ep.EdgeID;
  if (isEdge) {
    log.info({
      endpointId: ep.Id,
      name: ep.Name,
      type: ep.Type,
      portainerStatus: ep.Status,
      edgeId: ep.EdgeID,
      lastCheckInDate: ep.LastCheckInDate,
      edgeCheckinInterval: ep.EdgeCheckinInterval,
      hasSnapshots: (ep.Snapshots?.length ?? 0) > 0,
      snapshotTime: ep.Snapshots?.[0]?.Time,
    }, 'Normalizing Edge endpoint');
  }
  const snapshot = ep.Snapshots?.[0];
  const raw = snapshot?.DockerSnapshotRaw;
  const edgeMode: 'standard' | 'async' | null = isEdge
    ? ((ep as Record<string, unknown>).QueryDate ? 'async' : 'standard')
    : null;
  const snapshotTime = snapshot?.Time;
  const snapshotAge = snapshotTime ? Date.now() - snapshotTime * 1000 : null;
  const status = isEdge ? determineEdgeStatus(ep) : (ep.Status === 1 ? 'up' : 'down');

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
  };
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
