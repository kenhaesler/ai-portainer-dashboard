import type { Endpoint, Container, Stack, Network } from '../models/portainer.js';

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

export function normalizeEndpoint(ep: Endpoint): NormalizedEndpoint {
  const snapshot = ep.Snapshots?.[0];
  const raw = snapshot?.DockerSnapshotRaw;
  return {
    id: ep.Id,
    name: ep.Name,
    type: ep.Type,
    url: ep.URL,
    status: ep.Status === 1 ? 'up' : 'down',
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
    isEdge: !!ep.EdgeID,
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
