import type { Container } from '@/features/containers/hooks/use-containers';
import type { SelectOptionGroup } from '@/shared/components/themed-select';

export const NO_STACK_LABEL = 'No Stack';

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
  // Docker Compose: <stack>-<service>-<replica-index>
  // Match containerName ending with "-<serviceName>-<digits>"
  const composeSuffix = `-${serviceName}-`;
  const composeIdx = containerName.indexOf(composeSuffix);
  if (composeIdx > 0) {
    const afterService = containerName.slice(composeIdx + composeSuffix.length);
    if (/^\d+$/.test(afterService)) {
      return containerName.slice(0, composeIdx);
    }
  }

  // Swarm: <stack>_<service>.<replica>.<taskId>
  // Match containerName containing "_<serviceName>."
  const swarmSuffix = `_${serviceName}.`;
  const swarmIdx = containerName.indexOf(swarmSuffix);
  if (swarmIdx > 0) {
    return containerName.slice(0, swarmIdx);
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
    const stackName = resolveContainerStackName(container, knownStackNames) ?? NO_STACK_LABEL;
    const existing = grouped.get(stackName) ?? [];
    existing.push({ value: container.id, label: container.name });
    grouped.set(stackName, existing);
  }

  const stackGroups: SelectOptionGroup[] = [];
  const noStackGroup: SelectOptionGroup = { label: NO_STACK_LABEL, options: [] };

  for (const [stackName, options] of grouped.entries()) {
    const group: SelectOptionGroup = { label: stackName, options: options.sort(byLabel) };
    if (stackName === NO_STACK_LABEL) {
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

export function resolveContainerStackName(
  container: Pick<Container, 'name' | 'labels'>,
  knownStackNames: string[] = [],
): string | null {
  return inferStackFromKnownStacks(container.name, knownStackNames) ?? inferStackName(container);
}
