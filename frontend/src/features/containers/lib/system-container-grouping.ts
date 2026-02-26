import type { Container } from '@/hooks/use-containers';

export type ContainerGroup = 'system' | 'workload';

const SYSTEM_NAME_PATTERNS = [
  'beyla',
  'edge-agent',
  'edge_agent',
  'edgeagent',
];

const SYSTEM_IMAGE_PATTERNS = [
  'grafana/beyla',
  '/beyla',
  'portainer/agent',
  'edge-agent',
];

const SYSTEM_LABEL_PATTERNS = [
  'io.portainer.agent',
  'edge_id',
  'edgekey',
  'beyla-ebpf',
  'grafana/beyla',
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function getContainerGroup(container: Pick<Container, 'name' | 'image' | 'labels'>): ContainerGroup {
  const name = normalize(container.name);
  const image = normalize(container.image);

  if (includesAny(name, SYSTEM_NAME_PATTERNS) || includesAny(image, SYSTEM_IMAGE_PATTERNS)) {
    return 'system';
  }

  const labels = Object.entries(container.labels ?? {})
    .map(([key, value]) => `${normalize(key)}=${normalize(value)}`)
    .join(' ');

  if (includesAny(labels, SYSTEM_LABEL_PATTERNS)) {
    return 'system';
  }

  return 'workload';
}

export function getContainerGroupLabel(container: Pick<Container, 'name' | 'image' | 'labels'>): 'System' | 'Workload' {
  return getContainerGroup(container) === 'system' ? 'System' : 'Workload';
}
