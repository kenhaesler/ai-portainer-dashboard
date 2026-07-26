import type { Container } from '@/features/containers/hooks/use-containers';
import { resolveContainerStackName } from '@/features/containers/lib/container-stack-grouping';

/**
 * Every field prefix `parseSearchQuery` understands, in the order the UI lists
 * them. Exported so the search bar's syntax hint is generated from the parser
 * rather than retyped next to it — `label:` was supported here and named in no
 * hint and no chip, so the one filter that finds a Docker Hardened image by its
 * `com.docker.dhi.name` label was undiscoverable.
 */
export const SEARCH_FIELDS = [
  'name',
  'image',
  'state',
  'status',
  'stack',
  'endpoint',
  'port',
  'label',
] as const;

export interface SearchToken {
  field?: (typeof SEARCH_FIELDS)[number];
  value: string;
}

type FieldName = NonNullable<SearchToken['field']>;

const FIELD_NAMES = new Set<FieldName>(SEARCH_FIELDS);

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

/** `registry.example.com/team/api-service:1.4.2` → `api-service`. */
function imageBaseName(image: string): string {
  const lastSlash = image.lastIndexOf('/');
  const tail = lastSlash >= 0 ? image.slice(lastSlash + 1) : image;
  const at = tail.indexOf('@');
  const withoutDigest = at > 0 ? tail.slice(0, at) : tail;
  const colon = withoutDigest.lastIndexOf(':');
  return colon > 0 ? withoutDigest.slice(0, colon) : withoutDigest;
}

function tally(values: Array<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    // A value containing whitespace cannot round-trip through the query
    // parser (which splits on whitespace), so it can never be a chip.
    if (!value || /\s/.test(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * The most common value that still *narrows* the list. A value present on every
 * row is skipped: a chip that returns all rows is a chip that does nothing.
 */
function mostCommonNarrowing(counts: Map<string, number>, total: number): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count >= total) continue;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Suggested filter chips, derived from the containers actually loaded.
 *
 * Every chip is built from a value read off a real container, so each one is
 * guaranteed to match at least one row and to narrow the list. The chips this
 * replaced were module-level literals (`image:nginx`, `stack:traefik`,
 * `endpoint:prod`) — working controls pointed at infrastructure that did not
 * exist, so clicking one emptied the table.
 *
 * Returns `[]` for an empty fleet: nothing to suggest, so show no chips.
 */
export function deriveSearchChips(
  containers: Container[],
  knownStackNames: string[],
): string[] {
  const total = containers.length;
  if (total === 0) return [];

  const chips: string[] = [];

  // State only when the fleet is mixed. On an all-running fleet `state:running`
  // returns every row unchanged; the rarest state is the one worth a click.
  const states = tally(containers.map((c) => c.state));
  if (states.size > 1) {
    const rarest = [...states.entries()].sort(
      (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
    )[0];
    chips.push(`state:${rarest[0]}`);
  }

  const stack = mostCommonNarrowing(
    tally(containers.map((c) => resolveContainerStackName(c, knownStackNames))),
    total,
  );
  if (stack) chips.push(`stack:${stack}`);

  const endpoint = mostCommonNarrowing(tally(containers.map((c) => c.endpointName)), total);
  if (endpoint) chips.push(`endpoint:${endpoint}`);

  const image = mostCommonNarrowing(
    tally(containers.map((c) => imageBaseName(c.image))),
    total,
  );
  if (image) chips.push(`image:${image}`);

  return chips;
}
