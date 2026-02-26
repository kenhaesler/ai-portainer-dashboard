import type { Container } from '@/hooks/use-containers';
import { resolveContainerStackName } from '@/lib/container-stack-grouping';

export interface SearchToken {
  field?: 'name' | 'image' | 'state' | 'status' | 'stack' | 'endpoint' | 'port' | 'label';
  value: string;
}

type FieldName = NonNullable<SearchToken['field']>;

const FIELD_NAMES = new Set<FieldName>(['name', 'image', 'state', 'status', 'stack', 'endpoint', 'port', 'label']);

function isFieldName(s: string): s is FieldName {
  return FIELD_NAMES.has(s as FieldName);
}

export function parseSearchQuery(query: string): SearchToken[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return trimmed.split(/\s+/).map((part) => {
    const colonIndex = part.indexOf(':');
    if (colonIndex > 0) {
      const possibleField = part.slice(0, colonIndex).toLowerCase();
      const value = part.slice(colonIndex + 1);
      if (isFieldName(possibleField) && value) {
        return { field: possibleField, value };
      }
    }
    return { value: part };
  });
}

function matchesToken(container: Container, token: SearchToken, knownStackNames: string[]): boolean {
  const val = token.value.toLowerCase();

  if (token.field) {
    switch (token.field) {
      case 'name':
        return container.name.toLowerCase().includes(val);
      case 'image':
        return container.image.toLowerCase().includes(val);
      case 'state':
        return container.state.toLowerCase().includes(val);
      case 'status':
        return container.status.toLowerCase().includes(val);
      case 'endpoint':
        return container.endpointName.toLowerCase().includes(val);
      case 'stack': {
        const stackName = resolveContainerStackName(container, knownStackNames);
        return (stackName?.toLowerCase().includes(val)) ?? false;
      }
      case 'port':
        return container.ports.some((p) =>
          String(p.public ?? p.private).includes(val),
        );
      case 'label':
        return Object.values(container.labels).some((v) => v.toLowerCase().includes(val));
    }
  }

  // Free text — try all fields
  if (container.name.toLowerCase().includes(val)) return true;
  if (container.image.toLowerCase().includes(val)) return true;
  if (container.state.toLowerCase().includes(val)) return true;
  if (container.status.toLowerCase().includes(val)) return true;
  if (container.endpointName.toLowerCase().includes(val)) return true;
  const stackName = resolveContainerStackName(container, knownStackNames);
  if (stackName?.toLowerCase().includes(val)) return true;
  if (container.ports.some((p) => String(p.public ?? p.private).includes(val))) return true;
  if (Object.values(container.labels).some((v) => v.toLowerCase().includes(val))) return true;

  return false;
}

export function filterContainers(
  containers: Container[],
  query: string,
  knownStackNames: string[],
): Container[] {
  const tokens = parseSearchQuery(query);
  if (tokens.length === 0) return containers;
  return containers.filter((container) =>
    tokens.every((token) => matchesToken(container, token, knownStackNames)),
  );
}
