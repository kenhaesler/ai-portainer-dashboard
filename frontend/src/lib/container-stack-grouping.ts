import type { Container } from '@/hooks/use-containers';
import type { SelectOptionGroup } from '@/components/shared/themed-select';

const STACK_LABEL_KEYS = [
  'com.docker.compose.project',
  'com.docker.stack.namespace',
  'io.portainer.stack.name',
];

function getStackName(container: Pick<Container, 'labels'>): string | null {
  for (const key of STACK_LABEL_KEYS) {
    const value = container.labels[key]?.trim();
    if (value) return value;
  }
  return null;
}

function inferStackFromServiceName(containerName: string, serviceName: string): string | null {
  const escapedServiceName = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const composeDashPattern = new RegExp(`^(.*)-${escapedServiceName}-\\d+$`);
  const composeDashMatch = containerName.match(composeDashPattern);
  if (composeDashMatch?.[1]) {
    return composeDashMatch[1];
  }

  const swarmUnderscorePattern = new RegExp(`^(.*)_${escapedServiceName}\\.`);
  const swarmUnderscoreMatch = containerName.match(swarmUnderscorePattern);
  if (swarmUnderscoreMatch?.[1]) {
    return swarmUnderscoreMatch[1];
  }

  return null;
}

function inferStackFromContainerName(containerName: string): string | null {
  // Docker Compose default: <project>-<service>-<index>
  const composeMatch = containerName.match(/^(.*)-[^-]+-\d+$/);
  if (composeMatch?.[1]) {
    return composeMatch[1];
  }

  // Swarm-like task naming: <stack>_<service>.<replica>.<taskId>
  const swarmMatch = containerName.match(/^(.*)_[^.]+\.\d+\./);
  if (swarmMatch?.[1]) {
    return swarmMatch[1];
  }

  return null;
}

function inferStackName(container: Pick<Container, 'name' | 'labels'>): string | null {
  const explicit = getStackName(container);
  if (explicit) return explicit;

  const swarmServiceName = container.labels['com.docker.swarm.service.name']?.trim();
  if (swarmServiceName?.includes('_')) {
    return swarmServiceName.split('_')[0];
  }

  const composeServiceName = container.labels['com.docker.compose.service']?.trim();
  if (composeServiceName) {
    return inferStackFromServiceName(container.name, composeServiceName);
  }

  return inferStackFromContainerName(container.name);
}

function inferStackFromKnownStacks(containerName: string, knownStackNames: string[]): string | null {
  const normalizedContainerName = containerName.toLowerCase();
  const sortedByLength = [...knownStackNames].sort((a, b) => b.length - a.length);

  for (const stackName of sortedByLength) {
    const normalizedStackName = stackName.toLowerCase();
    if (
      normalizedContainerName === normalizedStackName
      || normalizedContainerName.startsWith(`${normalizedStackName}-`)
      || normalizedContainerName.startsWith(`${normalizedStackName}_`)
      || normalizedContainerName.startsWith(`${normalizedStackName}.`)
    ) {
      return stackName;
    }
  }

  return null;
}

function byLabel(a: { label: string }, b: { label: string }) {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
}

export function buildStackGroupedContainerOptions(
  containers: Array<Pick<Container, 'id' | 'name' | 'labels'>>,
  knownStackNames: string[] = [],
): SelectOptionGroup[] {
  const grouped = new Map<string, Array<{ value: string; label: string }>>();

  for (const container of containers) {
    const stackName = inferStackFromKnownStacks(container.name, knownStackNames)
      ?? inferStackName(container)
      ?? 'No Stack';
    const existing = grouped.get(stackName) ?? [];
    existing.push({ value: container.id, label: container.name });
    grouped.set(stackName, existing);
  }

  const stackGroups: SelectOptionGroup[] = [];
  const noStackGroup: SelectOptionGroup = { label: 'No Stack', options: [] };

  for (const [stackName, options] of grouped.entries()) {
    const group: SelectOptionGroup = { label: stackName, options: options.sort(byLabel) };
    if (stackName === 'No Stack') {
      noStackGroup.options = group.options;
    } else {
      stackGroups.push(group);
    }
  }

  stackGroups.sort(byLabel);
  if (noStackGroup.options.length > 0) {
    stackGroups.push(noStackGroup);
  }
  return stackGroups;
}
