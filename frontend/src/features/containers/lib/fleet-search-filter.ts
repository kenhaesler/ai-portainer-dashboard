import type { Endpoint } from '@/features/containers/hooks/use-endpoints';

export interface StackWithEndpoint {
  id: number;
  name: string;
  type: number;
  endpointId: number;
  status: 'active' | 'inactive';
  endpointName: string;
  containerCount?: number;
  envCount: number;
  source?: 'portainer' | 'compose-label';
  createdAt?: number;
  updatedAt?: number;
}

export interface FleetSearchToken {
  field?: EndpointFieldName | StackFieldName;
  value: string;
}

type EndpointFieldName = 'name' | 'status' | 'url' | 'type';
type StackFieldName = 'name' | 'status' | 'endpoint';

const ENDPOINT_FIELDS = new Set<EndpointFieldName>(['name', 'status', 'url', 'type']);
const STACK_FIELDS = new Set<StackFieldName>(['name', 'status', 'endpoint']);

type AllFieldNames = EndpointFieldName | StackFieldName;
const ALL_FIELDS = new Set<AllFieldNames>(['name', 'status', 'url', 'type', 'endpoint']);

function isFieldName(s: string): s is AllFieldNames {
  return ALL_FIELDS.has(s as AllFieldNames);
}

export function parseFleetSearchQuery(query: string): FleetSearchToken[] {
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

function getEndpointTypeName(type: number): string {
  switch (type) {
    case 1: return 'docker';
    case 2: return 'agent';
    case 3: return 'azure';
    case 4: return 'edge';
    case 5: return 'kubernetes';
    default: return String(type);
  }
}

function endpointMatchesToken(endpoint: Endpoint, token: FleetSearchToken): boolean {
  const val = token.value.toLowerCase();

  if (token.field) {
    if (!ENDPOINT_FIELDS.has(token.field as EndpointFieldName)) return false;
    switch (token.field) {
      case 'name':
        return endpoint.name.toLowerCase().includes(val);
      case 'status':
        return endpoint.status.toLowerCase().includes(val);
      case 'url':
        return endpoint.url.toLowerCase().includes(val);
      case 'type':
        return getEndpointTypeName(endpoint.type).includes(val);
      default:
        return false;
    }
  }

  // Free text — match across name, URL, status, and type
  if (endpoint.name.toLowerCase().includes(val)) return true;
  if (endpoint.url.toLowerCase().includes(val)) return true;
  if (endpoint.status.toLowerCase().includes(val)) return true;
  if (getEndpointTypeName(endpoint.type).includes(val)) return true;

  return false;
}

export function filterEndpoints(endpoints: Endpoint[], query: string): Endpoint[] {
  const tokens = parseFleetSearchQuery(query);
  if (tokens.length === 0) return endpoints;
  return endpoints.filter((endpoint) =>
    tokens.every((token) => endpointMatchesToken(endpoint, token)),
  );
}

function stackMatchesToken(stack: StackWithEndpoint, token: FleetSearchToken): boolean {
  const val = token.value.toLowerCase();

  if (token.field) {
    if (!STACK_FIELDS.has(token.field as StackFieldName)) return false;
    switch (token.field) {
      case 'name':
        return stack.name.toLowerCase().includes(val);
      case 'status':
        return stack.status.toLowerCase().includes(val);
      case 'endpoint':
        return stack.endpointName.toLowerCase().includes(val);
      default:
        return false;
    }
  }

  // Free text — match across stack name, endpoint name, and container count
  if (stack.name.toLowerCase().includes(val)) return true;
  if (stack.endpointName.toLowerCase().includes(val)) return true;
  if (stack.containerCount !== undefined && String(stack.containerCount).includes(val)) return true;

  return false;
}

export function filterStacks(stacks: StackWithEndpoint[], query: string): StackWithEndpoint[] {
  const tokens = parseFleetSearchQuery(query);
  if (tokens.length === 0) return stacks;
  return stacks.filter((stack) =>
    tokens.every((token) => stackMatchesToken(stack, token)),
  );
}
