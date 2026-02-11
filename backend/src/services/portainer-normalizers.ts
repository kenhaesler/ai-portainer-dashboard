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
