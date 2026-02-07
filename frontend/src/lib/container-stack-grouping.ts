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

function byLabel(a: { label: string }, b: { label: string }) {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
}

export function buildStackGroupedContainerOptions(
  containers: Array<Pick<Container, 'id' | 'name' | 'labels'>>,
): SelectOptionGroup[] {
  const grouped = new Map<string, Array<{ value: string; label: string }>>();

  for (const container of containers) {
    const stackName = getStackName(container) ?? 'No Stack';
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
